const child_process = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tar = require('tar');
const { v4: uuidv4 } = require('uuid');

const bluecanvasSdk = require('@bluecanvas/sdk');
const Hapi = require('@hapi/hapi');
const rimraf = require('rimraf');

const { CheckResult, CheckState } = bluecanvasSdk;


/**
 * PMD results stored in-memory to serve the example.
 *
 * Practically, these should be stored durably.
 */
const pmdResults = {
  results: {},
  get(id) {
    return this.results[id];
  },
  set(id, log) {
    this.results[id] = log;
  }
};


const main = async () => {
  if ([
    'BLUECANVAS_CLIENT_ID',
    'BLUECANVAS_CLIENT_SECRET',
    'BLUECANVAS_TENANT_ID',
    'BLUECANVAS_REPO_ID',
    'PMD_HOME',
    'BASE_URL',
    'PORT',
  ].filter(k => {
    if (!process.env[k]) {
      console.error(`error: Environment variable ${k} must be set.`);
      return true;
    }
  }).length) {
    process.exit(1);
  }

  let clientOptions = {
    clientId: process.env.BLUECANVAS_CLIENT_ID,
    clientSecret: process.env.BLUECANVAS_CLIENT_SECRET,
  }

  if (process.env.BLUECANVAS_BASE_URL) {
    clientOptions['baseUrl'] = process.env.BLUECANVAS_BASE_URL;
  }

  if (process.env.TOKEN_URL) {
    clientOptions['tokenUrl'] = process.env.TOKEN_URL;
  }

  const bluecanvas = new bluecanvasSdk.Client(clientOptions);

  const server = new Hapi.Server({
    port: process.env.PORT,
    debug: {request: ['error']},
  });

  server.events.on('request', req => console.log(req.method.toUpperCase(), req.path));

  server.route({
    method: 'GET',
    path: '/pmd-results/{id}',
    handler: async (req, h) => {
      const log = pmdResults.get(req.params.id);
      if (!log) {
        return h.response('Not found').code(404);
      }
      return h.response(log).type('text/plain');
    },
  });

  await server.register({
    plugin: bluecanvasSdk.EventHandlerPlugin,
    options: {
      tenantId: process.env.BLUECANVAS_TENANT_ID,
      onNotification: async (req, h, msg) => {
        if (
          msg.Event === 'deployments/validated' &&
          msg.Validation.state === 'DONE' &&
          msg.Validation.result === 'SUCCEEDED' &&
          // Apex changes.
          msg.Deployment.files.some(f => f.endsWith('.cls'))
        ) {
          console.log('Running PMD check...');
          await runPmdCheck(bluecanvas, msg.Deployment.deploymentNumber, msg.Deployment.deploymentBranchName);
        }

        return '';
      },
    },
  });

  await server.start();
};


const findRepoDirSync = (dirname, repoId) => {
  const isRepoDir = f => f.isDirectory() && f.name.startsWith(repoId);
  const files = fs.readdirSync(dirname, { withFileTypes: true });
  const repoDir = files.filter(isRepoDir)[0].name;
  return repoDir;
};


const runPmdCheck = async (bluecanvas, deploymentNumber, deploymentBranchName) => {
  const putCheck = async check => {
    await bluecanvas.deployments.putCheck({
      deploymentNumber,
      name: 'PMD',
      check,
    });
  };

  await putCheck({
    state: CheckState.IN_PROGRESS,
    result: CheckResult.NEUTRAL,
    description: 'Starting...'
  });

  const archive = await bluecanvas.archives.getTarGzipBlob({
    revision: deploymentBranchName
  });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bluecanvas-pmd-'));
  process.chdir(tmpDir);

  // Deployment branch names contain slashes.
  const archName = deploymentBranchName.replace(/\//g, '-');
  const archPath = path.join(tmpDir, `${archName}.tgz`);
  fs.writeFileSync(archPath, archive.blob);

  try {
    tar.x({
      file: archPath,
      gzip: true,
      sync: true,
    });

    const repoDir = findRepoDirSync('.', process.env.BLUECANVAS_REPO_ID);

    try {
      const out = child_process.execFileSync(
        path.join(process.env.PMD_HOME, 'bin', 'run.sh'), [
          'pmd',
          '-d', path.join(process.cwd(), repoDir, 'src'),
          '-R', 'rulesets/apex/quickstart.xml'
        ], {}
      );
    } catch (e) {
      const resultId = uuidv4();
      const out = e.stdout.toString().trim();
      pmdResults.set(resultId, out);

      await putCheck({
        state: CheckState.DONE,
        result: CheckResult.FAILURE,
        description: 'Found some problems.',
        externalUrl: `${process.env.BASE_URL}/pmd-results/${resultId}`,
        externalId: resultId,
      });

      return;
    }

    await putCheck({
      state: CheckState.DONE,
      result: CheckResult.SUCCESS,
      description: 'No problems.'
    });
  } finally {
    rimraf.sync(tmpDir);
  }
};


process.on('unhandledRejection', err => {
  console.log(err);
  process.exit(1);
});


main();
