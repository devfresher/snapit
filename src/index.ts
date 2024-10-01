#!/usr/bin/env node

import { Command } from 'commander';
import inquirer from 'inquirer';
import { backupDatabase } from './backup';
// import { restoreDatabase } from './restore';

const program = new Command();

program.name('snapit').description('CLI tool for database backup and restoration').version('1.0.0');

program
  .command('backup')
  .description('Backup a database')
  .option('--dbType <dbType>', 'Database type (PostgreSQL, MySQL, MongoDB)')
  .option('--dbName <dbName>', 'Name of the database to backup')
  .option('--location <location>', 'Backup location (Local, AWS S3, Google Cloud, Azure)')
  .action(async (options) => {
    if (options.dbType && options.dbName && options.location) {
      console.log(`Backing up ${options.dbName} (${options.dbType}) to ${options.location}`);
      // Implement backup logic directly with provided options
    } else {
      // await backupDatabase(); // Fallback to interactive mode if no options are provided
    }
  });

program
  .command('restore')
  .description('Restore a database')
  .action(async () => {
    // await restoreDatabase();
  });

program
  .command('run')
  .description('Interactively select backup or restore')
  .action(async () => {
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: ['Backup', 'Restore'],
      },
    ]);

    if (action === 'Backup') {
      await backupDatabase();
    } else if (action === 'Restore') {
      // Coming Soon
      // await restoreDatabase();
    }
  });

program.parse(process.argv);
