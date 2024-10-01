import fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import inquirer from 'inquirer';
import AWS from 'aws-sdk';
import * as path from 'path';
import archiver from 'archiver';
import { Storage } from '@google-cloud/storage';
import { BlobServiceClient } from '@azure/storage-blob';

const execAsync = promisify(exec);

async function uploadToS3(filePath: string, bucketName: string, destinationPath: string) {
  const s3 = new AWS.S3();
  const fileStream = fs.createReadStream(filePath);

  const params = {
    Bucket: bucketName,
    Key: destinationPath,
    Body: fileStream,
  };

  return s3.upload(params).promise();
}

async function uploadToGoogleCloud(filePath: string, bucketName: string, destinationPath: string) {
  const storage = new Storage();
  await storage.bucket(bucketName).upload(filePath, { destination: destinationPath });
}

async function dumpDatabase(
  dbType: string,
  dbName: string,
  user: string,
  password: string,
  host: string,
  backupPath?: string
) {
  const dumpCommand = getDumpCommand(dbType, dbName, user, password, host, backupPath);

  await execAsync(dumpCommand);
  console.log(`Database ${dbName} backup completed successfully.`);

  const zipFilePath = await zipDatabaseBackup(backupPath, dbName);
  console.log(`Database ${dbName} backup has been zipped: ${zipFilePath}`);

  return zipFilePath;
}

function getDumpCommand(
  dbType: string,
  dbName: string,
  user: string,
  password: string,
  host: string,
  path?: string
) {
  const cwd = process.cwd();
  const filePath = path ? `${path}/${dbName}.sql` : `${cwd}/${dbName}.sql`;

  switch (dbType) {
    case 'PostgreSQL':
      return `PGPASSWORD=${password} pg_dump -U ${user} -h ${host} ${dbName} > ${filePath}`;

    case 'MySQL':
      return `mysqldump -u ${user} -p${password} -h ${host} ${dbName} > ${filePath}`;

    case 'MongoDB':
      const backupPath = path ? `${path}/${dbName}_backup` : `${cwd}/${dbName}_backup`;
      return `mongodump --db ${dbName} --out ${backupPath}`;

    default:
      throw new Error(`Unsupported database type: ${dbType}`);
  }
}

async function zipDatabaseBackup(backupPath: string | undefined, dbName: string): Promise<string> {
  const cwd = process.cwd();
  const outputDir = backupPath || cwd;
  const outputFilePath = path.join(outputDir, `${dbName}.zip`);
  const output = fs.createWriteStream(outputFilePath);
  const archive = archiver('zip', {
    zlib: { level: 9 }, // Highest compression level
  });

  return new Promise((resolve, reject) => {
    output.on('close', () => {
      console.log(`${archive.pointer()} total bytes`);
      console.log('Backup has been zipped successfully.');
      resolve(outputFilePath);
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);

    // Add the backup files to the archive
    if (fs.existsSync(`${outputDir}/${dbName}.sql`)) {
      archive.file(`${outputDir}/${dbName}.sql`, { name: `${dbName}.sql` });
    } else if (fs.existsSync(`${outputDir}/${dbName}_backup`)) {
      archive.directory(`${outputDir}/${dbName}_backup`, `${dbName}_backup`);
    }

    archive.finalize();
  });
}

export async function backupDatabase() {
  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'dbType',
      message: 'Which database do you want to backup?',
      choices: ['PostgreSQL', 'MySQL', 'MongoDB'],
    },
    {
      type: 'input',
      name: 'dbName',
      message: 'Name of the db?',
      required: true,
    },
    {
      type: 'input',
      name: 'user',
      message: 'DB user name?',
    },
    {
      type: 'password',
      name: 'password',
      message: 'DB password?',
    },
    {
      type: 'input',
      name: 'host',
      message: 'DB host? (e.g., localhost, 127.0.0.1)',
      default: 'localhost',
    },
    {
      type: 'list',
      name: 'backupLocation',
      message: 'Storage location?',
      choices: ['Local', 'AWS S3', 'Google Cloud', 'Azure'],
      default: 'Local',
    },
  ]);

  const { dbType, dbName, user, password, host, backupLocation } = answers;

  const backupPath =
    backupLocation === 'Local'
      ? (
          await inquirer.prompt([
            {
              type: 'input',
              name: 'path',
              message: 'Enter the path to store the backup (e.g. /home/user/backups)',
            },
          ])
        ).path
      : undefined;

  // Perform the database dump and zip it
  const zipFilePath = await dumpDatabase(dbType, dbName, user, password, host, backupPath);

  // Upload to cloud if selected
  if (backupLocation) {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'storageConfig',
        message: 'Storage config file path?',
        default: 'config.json',
      },
    ]);

    const storageConfig = JSON.parse(fs.readFileSync(answers.storageConfig, 'utf8'));

    if (backupLocation === 'AWS S3') {
      if (
        !storageConfig.S3 ||
        !storageConfig.S3.bucket ||
        !storageConfig.S3.key ||
        !storageConfig.S3.region ||
        !storageConfig.S3.accessKeyId ||
        !storageConfig.S3.secretAccessKey
      ) {
        throw new Error('AWS S3 configuration is not valid');
      }

      await uploadToS3(zipFilePath, storageConfig.S3.bucket, `${dbName}.zip`);
    } else if (backupLocation === 'Google Cloud') {
      if (!storageConfig.GC || !storageConfig.GC.bucket || !storageConfig.GC.key) {
        throw new Error('Google Cloud configuration is not valid');
      }
      await uploadToGoogleCloud(zipFilePath, storageConfig.GC.bucket, `${dbName}.zip`);
    }
  }
}
