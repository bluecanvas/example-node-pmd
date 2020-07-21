const child_process = require('child_process');
const fs = require('fs');
const path = require('path');
const tar = require('tar');

const bluecanvasSdk = require('@bluecanvas/sdk');
const { CheckResult, CheckState } = require('@bluecanvas/sdk/dist/types');
const Hapi = require('@hapi/hapi');


const main = async () => {
  if (!(
    process.env.BLUECANVAS_BASE_URL &&
    process.env.BLUECANVAS_CLIENT_ID &&
    process.env.BLUECANVAS_CLIENT_SECRET &&
    process.env.BLUECANVAS_TENANT_ID &&
    process.env.BLUECANVAS_REPO_ID &&
    process.env.PMD_HOME
  )) {
    console.error(
      'BLUECANVAS_BASE_URL, BLUECANVAS_CLIENT_ID, BLUECANVAS_CLIENT_SECRET, ' +
      'BLUECANVAS_TENANT_ID, BLUECANVAS_REPO_ID, and PMD_HOME are required.'
    );
    process.exit(1);
  }

  const s = new Hapi.Server({
    port: 3000,
    debug: {request: ['error']},
  });

  s.events.on('request', req => console.log(req.method.toUpperCase(), req.path));

  const bluecanvas = new bluecanvasSdk.Client({
    clientId: process.env.BLUECANVAS_CLIENT_ID,
    clientSecret: process.env.BLUECANVAS_CLIENT_SECRET,
    tokenScope: 'api:tenant',
    tokenAudience: process.env.BLUECANVAS_TOKEN_AUDIENCE,
    baseUrl: `${process.env.BLUECANVAS_BASE_URL}/apis/rest/v1`,
  });

  await s.register({
    plugin: bluecanvasSdk.EventHandlerPlugin,
    options: {
      tenantId: process.env.BLUECANVAS_TENANT_ID,
      onNotification: async (req, h, msg) => {
        if (msg.Event === 'deployments/validated' &&
          msg.Validation.state === 'DONE' &&
          msg.Validation.result === 'SUCCEEDED' &&
          // Apex changes.
          msg.Deployment.files.some(f => f.endsWith('.cls'))) {
          console.log('Running PMD check...');
          await runPmdCheck(bluecanvas, msg.Deployment.deploymentNumber, msg.Deployment.mergeBranchName);
        }

        return '';
      }
    }
  });

  await s.start();
};


const runPmdCheck = async (bluecanvas, deploymentNumber, mergeBranchName) => {
  const checkName = 'PMD';

  await bluecanvas.deployments.putCheck({
    deploymentNumber,
    name: checkName,
    check: {
      state: CheckState.IN_PROGRESS,
      result: CheckResult.NEUTRAL,
      description: 'Starting...',
    }
  });

  const resp = await bluecanvas.archives.getTarGzipBlob({
    revision: mergeBranchName
  });

  const tmpDir = fs.mkdtempSync();
  const archPath = pat.join(tmpDir, `${mergeBranchName}.tgz`);

  fs.writeFileSync(archPath, resp.blob);

  process.chdir(tmpDir);

  try {
    tar.x({
      file: archPath,
      gzip: true,
      sync: true,
    });

    try {
      const out = child_process.execFileSync(
        path.join(process.env.PMD_HOME, 'bin', 'run.sh'),
        [
          'pmd',
          '-d',
          path.join(
            process.cwd(),
            `${process.env.BLUECANVAS_REPO_ID}-${mergeBranchName}-${mergeBranchName}`,
            'src',
          ),
          '-R',
          'rulesets/apex/quickstart.xml'
        ],
        {}
      );
    } catch (e) {
      await bluecanvas.deployments.putCheck({
        deploymentNumber,
        name: checkName,
        check: {
          state: CheckState.DONE,
          result: CheckResult.FAILURE,
          description: 'Found some problems.',
          shortLog: e.stdout.toString().trim(),
        }
      });

      return;
    }

    await bluecanvas.deployments.putCheck({
      deploymentNumber,
      name: checkName,
      check: {
        state: CheckState.DONE,
        result: CheckResult.SUCCESS,
        description: 'No problems.'
      }
    });
  } finally {
    fs.rmdirSync(tmpDir);
  }
};


main();
