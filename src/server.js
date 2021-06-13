const child_process = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tar = require('tar');
const { v4: uuidv4 } = require('uuid');

const sdk = require('@bluecanvas/sdk');
const Hapi = require('@hapi/hapi');
const rimraf = require('rimraf');

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

  /*
   * Initialize Blue Canvas SDK
   */
  let clientOptions = {
    clientId: process.env.BLUECANVAS_CLIENT_ID,
    clientSecret: process.env.BLUECANVAS_CLIENT_SECRET,
  };

  if (process.env.TOKEN_URI) {
    clientOptions['tokenUri'] = process.env.TOKEN_URI;
  }

  const bluecanvas = new sdk.Client(clientOptions);

  /*
   * Initialize web server
   */
  const server = new Hapi.Server({
    port: process.env.PORT,
    debug: { log: '*', request: '*' },
  });

  server.events.on('log', msg => console.log(msg));
  server.events.on('response', req => console.log(
    "%s %s %s", req.method.toUpperCase(), req.path, req.response.statusCode));

  server.route({
    method: '*',
    path: '/{p*}',
    handler: async (req, h) => {
      return h.response('The requested page was not found').code(404);
    },
  });

  /**
   * Add route to view PMD results
   */
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

  /**
   * Add route to handle webhook notifications
   */
  await server.register({
    plugin: sdk.EventHandlerPlugin,
    options: {
      tenantId: process.env.BLUECANVAS_TENANT_ID,
      onNotification: async (req, h, msg) => {
        console.log(msg);

        if (
          msg.Event === 'deployments/validated' &&
          msg.Validation.state === 'DONE' &&
          msg.Validation.result === 'SUCCESS' &&
          // This condition checks if the deployment request contains any
          // files with a filename ending in '.cls', because we only want
          // to run PMD if Apex code has changed:
          msg.Deployment.files.some(f => f.endsWith('.cls'))
        ) {
          console.log('Running PMD check...');
          await runPmdCheck(
            bluecanvas,
            msg.Deployment.deploymentNumber,
            msg.Deployment.deploymentBranchName
          );
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
  return files.filter(isRepoDir)[0].name;
};

/**
 * Executes PMD on the command-line and notifies Blue Canvas about progress
 * via the Checks API.
 */
async function runPmdCheck(bluecanvas, deploymentNumber, deploymentBranchName) {
  const putCheck = async check => {
    await bluecanvas.deployments.putCheck({
      deploymentNumber,
      name: 'PMD',
      check,
    });
  };

  // Mark deployment check as in-progress
  await putCheck({
    state: 'IN_PROGRESS',
    result: 'NEUTRAL',
    description: 'Starting...'
  });

  // Fetch the files from Blue Canvas into a temporary folder
  const archive = await bluecanvas.archives.getTarGzipBlob({
    revision: deploymentBranchName
  });

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bluecanvas-pmd-'));
  process.chdir(tmpDir);
  fs.writeFileSync('archive.tgz', archive.blob);

  try {
    // Unpack files
    tar.x({
      file: 'archive.tgz',
      gzip: true,
      sync: true,
    });

    const repoDir = findRepoDirSync('.', process.env.BLUECANVAS_REPO_ID);

    try {
      // Execute `pmd` command
      const pmdBin = path.join(process.env.PMD_HOME, 'bin', 'run.sh');
      child_process.execFileSync(pmdBin, [
        'pmd',
        '-d', path.join(process.cwd(), repoDir, 'src'),
        '-R', 'rulesets/apex/quickstart.xml'
      ], {});

    } catch (e) {
      console.error(e);

      // Save the error log
      const resultId = uuidv4();
      const out = e.stdout
        ? e.stdout.toString().trim()
        : `${e}`;
      pmdResults.set(resultId, out);

      // Mark deployment check as failure
      await putCheck({
        state: 'DONE',
        result: 'FAILURE',
        description: 'Found some problems.',
        externalUrl: `${process.env.BASE_URL}/pmd-results/${resultId}`,
        externalId: resultId,
      });

      return;
    }

    // Mark deployment check as success
    await putCheck({
      state: 'DONE',
      result: 'SUCCESS',
      description: 'No problems.'
    });
  } finally {
    // Clean up temporary files
    rimraf.sync(tmpDir);
  }
}


process.on('unhandledRejection', err => {
  console.log(err);
  process.exit(1);
});


main();
