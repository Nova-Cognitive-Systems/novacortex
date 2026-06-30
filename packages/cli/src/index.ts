#!/usr/bin/env node
import { Command } from 'commander';
import { registerSetupCommand } from './commands/setup.js';
import { registerLoginCommand } from './commands/auth/login.js';
import { registerLogoutCommand } from './commands/auth/logout.js';
import { registerWhoamiCommand } from './commands/auth/whoami.js';
import { registerProfileListCommand } from './commands/profile/list.js';
import { registerProfileUseCommand } from './commands/profile/use.js';
import { registerProfileShowCommand } from './commands/profile/show.js';
import { registerProfileRmCommand } from './commands/profile/rm.js';
import { registerProfileRenameCommand } from './commands/profile/rename.js';
import { registerTokensListCommand } from './commands/admin/tokens/list.js';
import { registerTokensCreateCommand } from './commands/admin/tokens/create.js';
import { registerTokensRevokeCommand } from './commands/admin/tokens/revoke.js';
import {
  registerMemoryStoreCommand,
  registerMemoryRecallCommand,
  registerMemoryListCommand,
  registerMemorySearchCommand,
  registerMemoryForgetCommand,
  registerMemoryRelateCommand,
  registerMemoryExportCommand,
  registerMemoryImportCommand,
  registerKnowledgeUploadCommand,
  registerStatsCommand,
  registerReplCommand,
} from './commands/memory/index.js';

const pkg = { name: 'novacortex', version: '1.0.0' };

const program = new Command()
  .name(pkg.name)
  .description('Manage NovaCortex memory servers from the command line')
  .version(pkg.version);

registerSetupCommand(program);

const authGroup = program.command('auth').description('Authentication commands');
registerLoginCommand(authGroup);
registerLogoutCommand(authGroup);
registerWhoamiCommand(authGroup);

const profileGroup = program.command('profile').description('Manage CLI profiles');
registerProfileListCommand(profileGroup);
registerProfileUseCommand(profileGroup);
registerProfileShowCommand(profileGroup);
registerProfileRmCommand(profileGroup);
registerProfileRenameCommand(profileGroup);

const adminGroup = program.command('admin').description('Server administration commands');
const tokensGroup = adminGroup.command('tokens').description('Manage server-side tokens');
registerTokensListCommand(tokensGroup);
registerTokensCreateCommand(tokensGroup);
registerTokensRevokeCommand(tokensGroup);

// Memory commands (top-level)
const memoryGroup = program.command('memory').description('Manage memories');
registerMemoryStoreCommand(memoryGroup);
registerMemoryRecallCommand(memoryGroup);
registerMemoryListCommand(memoryGroup);
registerMemorySearchCommand(memoryGroup);
registerMemoryForgetCommand(memoryGroup);
registerMemoryRelateCommand(memoryGroup);
registerMemoryExportCommand(memoryGroup);
registerMemoryImportCommand(memoryGroup);

// Shorthand aliases at top level
registerMemoryStoreCommand(program);
registerMemoryRecallCommand(program);
registerMemoryForgetCommand(program);

const knowledgeGroup = program.command('knowledge').description('Knowledge base commands');
registerKnowledgeUploadCommand(knowledgeGroup);

registerStatsCommand(program);
registerReplCommand(program);

program.parseAsync(process.argv).catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
