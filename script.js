const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const mime = require('mime-types');
const Redis = require('ioredis');


const accessKeyId = process.env.accessKeyId;
const secretAccessKey = process.env.secretAccessKey;
const PROJECT_ID = process.env.PROJECT_ID;
const DEPLOYMENT_ID = process.env.DEPLOYMENT_ID;
const REDIS_URI = process.env.REDIS_URI;

const publisher = new Redis(REDIS_URI);

const s3Client = new S3Client({
    region: 'ap-south-1',
    credentials: {
        accessKeyId: accessKeyId,
        secretAccessKey: secretAccessKey
    }
});

function publishLog(log) {
    publisher.publish(`logs:${DEPLOYMENT_ID}:${PROJECT_ID}`, JSON.stringify({ log }));
}

async function updateDeploymentStatus(deploymentId, status) {
    try {
        await publisher.publish(`status:${deploymentId}`, JSON.stringify({ status }));
        console.log(`Published status update for ${deploymentId}: ${status}`);
    } catch (err) {
        console.error("ERROR UPDATING STATUS", err);
    }
}

async function init() {
    try {
        console.log('Executing script.js');
        await updateDeploymentStatus(DEPLOYMENT_ID, 'IN_PROGRESS');
        publishLog('Build Started...');
        const outputDirPath = path.join(__dirname, 'output');
        
        const p = exec(`cd ${outputDirPath} && npm install && npm run build`);
        
        p.stdout.on('data',async  function (data) {
            console.log(data.toString());
            publishLog(data.toString());
        });

        p.stderr.on('data', async function (data) {
            await updateDeploymentStatus(DEPLOYMENT_ID, 'FAIL');
            publishLog(`ERROR: ${data.toString()}`);
        });

        p.on('close', async function (code) {
            if (code === 0) {
                publishLog('Build Complete...');
                console.log("Build Complete");
                const distFolderPath = path.join(outputDirPath, 'dist');
                const distFolderContents = fs.readdirSync(distFolderPath, { recursive: true });
                for (const file of distFolderContents) {
                    const filePath = path.join(distFolderPath, file);
                    if (fs.lstatSync(filePath).isDirectory()) {
                        continue;
                    }
                    console.log('Uploading', filePath);
                    const command = new PutObjectCommand({
                        Bucket: 'vercel-clone-2480',
                        Key: `__outputs/${PROJECT_ID}/${file}`,
                        Body: fs.createReadStream(filePath),
                        ContentType: mime.lookup(filePath) || 'application/octet-stream'
                    });

                    await s3Client.send(command);
                    console.log('Uploaded', filePath);
                    publishLog(`Uploaded ${filePath}`);
                }
                await updateDeploymentStatus(DEPLOYMENT_ID, 'READY');
            } else {
                publishLog('Build Failed...');
                await updateDeploymentStatus(DEPLOYMENT_ID, 'FAIL');
            }
            process.exit(code);
        });
    } catch (error) {
        console.error("An error occurred:", error);
        publishLog(`ERROR: ${error}`);
        await updateDeploymentStatus(DEPLOYMENT_ID, 'FAIL');
        process.exit(1);
    }
}

init();
