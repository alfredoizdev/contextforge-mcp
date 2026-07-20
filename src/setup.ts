#!/usr/bin/env node

import * as readline from 'readline';
import { execSync, spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { validateKey } from './validate-key.js';

// ============ Colors ============
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgBlue: '\x1b[44m',
  bgGreen: '\x1b[42m',
};

// ============ Helpers ============
function print(text: string) {
  console.log(text);
}

function printColor(text: string, color: string) {
  console.log(`${color}${text}${colors.reset}`);
}

function printSuccess(text: string) {
  console.log(`${colors.green}${text}${colors.reset}`);
}

function printError(text: string) {
  console.log(`${colors.red}${text}${colors.reset}`);
}

function printWarning(text: string) {
  console.log(`${colors.yellow}${text}${colors.reset}`);
}

function printDim(text: string) {
  console.log(`${colors.dim}${text}${colors.reset}`);
}

// ============ Banner ============
function printBanner() {
  const width = 60;
  const line = '─'.repeat(width);

  print('');
  print(`┌${line}┐`);
  print(`│${' '.repeat(width)}│`);
  print(`│${colors.bright}${colors.cyan}     ContextForge MCP Server Setup Wizard${colors.reset}${' '.repeat(17)}│`);
  print(`│${' '.repeat(width)}│`);
  print(`└${line}┘`);
  print('');
}

// ============ Check existing config ============
function getClaudeConfigPath(): string {
  const home = homedir();

  // Check platform-specific paths
  if (process.platform === 'darwin') {
    return join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  } else if (process.platform === 'win32') {
    return join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json');
  } else {
    return join(home, '.config', 'claude', 'claude_desktop_config.json');
  }
}

function checkExistingConfig(): { exists: boolean; hasContextForge: boolean; configPath: string } {
  const configPath = getClaudeConfigPath();

  if (!existsSync(configPath)) {
    return { exists: false, hasContextForge: false, configPath };
  }

  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    const hasContextForge = config?.mcpServers?.contextforge !== undefined;
    return { exists: true, hasContextForge, configPath };
  } catch {
    return { exists: true, hasContextForge: false, configPath };
  }
}

function checkClaudeCLI(): boolean {
  try {
    execSync('claude --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// Check if contextforge is configured in Claude Code CLI
function checkClaudeCodeConfig(): { configured: boolean; scope?: string; scopes?: string[] } {
  const home = homedir();
  const claudeJsonPath = join(home, '.claude.json');

  const scopes: string[] = [];

  try {
    if (existsSync(claudeJsonPath)) {
      const claudeConfig = JSON.parse(readFileSync(claudeJsonPath, 'utf-8'));

      // Check user scope (root mcpServers)
      if (claudeConfig?.mcpServers?.contextforge) {
        scopes.push('user');
      }

      // Check project scope (projects[path].mcpServers)
      if (claudeConfig?.projects) {
        const cwd = process.cwd();
        for (const [projectPath, projectConfig] of Object.entries(claudeConfig.projects)) {
          const config = projectConfig as { mcpServers?: { contextforge?: unknown } };
          if (config?.mcpServers?.contextforge) {
            // Check if this is the current project
            if (cwd.startsWith(projectPath)) {
              scopes.push('project');
            }
          }
        }
      }
    }

    // Fallback: check via claude mcp list command
    if (scopes.length === 0) {
      try {
        const output = execSync('claude mcp list', { stdio: 'pipe', encoding: 'utf-8' });
        if (output.toLowerCase().includes('contextforge')) {
          return { configured: true, scope: 'unknown', scopes: ['unknown'] };
        }
      } catch {
        // Ignore command errors
      }
    }

    if (scopes.length > 0) {
      // Prefer 'user' scope in display if both exist
      const primaryScope = scopes.includes('user') ? 'user' : scopes[0];
      return { configured: true, scope: primaryScope, scopes };
    }

    return { configured: false };
  } catch {
    return { configured: false };
  }
}

// ============ Setup Flow ============
async function askQuestion(rl: readline.Interface, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function runSetup() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  printBanner();

  print(`Welcome to ContextForge! This wizard will help you set up`);
  print(`your MCP server for the first time.`);
  print('');
  print(`You'll need:`);
  print(`  ${colors.cyan}•${colors.reset} Your ContextForge API key`);
  print(`  ${colors.cyan}•${colors.reset} An internet connection`);
  print('');
  printDim(`Don't have an API key yet?`);
  print(`Get one free at: ${colors.cyan}https://contextforge.dev/dashboard/api-keys${colors.reset}`);
  print('');
  print('─'.repeat(60));
  print('');

  // Check existing configuration (both Desktop and CLI)
  const desktopConfig = checkExistingConfig();
  const hasClaudeCLI = checkClaudeCLI();
  const cliConfig = hasClaudeCLI ? checkClaudeCodeConfig() : { configured: false };

  const isAlreadyConfigured = desktopConfig.hasContextForge || cliConfig.configured;

  if (isAlreadyConfigured) {
    const configLocation = cliConfig.configured ? 'Claude Code CLI' : 'Claude Desktop';
    printWarning(`Existing ContextForge configuration found in ${configLocation}.`);
    const overwrite = await askQuestion(rl, `Do you want to overwrite it? (y/N): `);
    if (overwrite.toLowerCase() !== 'y' && overwrite.toLowerCase() !== 'yes') {
      print('');
      printDim('Setup cancelled. Your existing configuration was preserved.');
      rl.close();
      process.exit(0);
    }
    print('');
  } else {
    printDim('No existing ContextForge configuration found. Running setup...');
    print('');
  }

  // Ask for API key
  const apiKey = await askQuestion(rl, `Enter your ContextForge API key: `);

  if (!apiKey) {
    print('');
    printError('API key is required. Setup cancelled.');
    rl.close();
    process.exit(1);
  }

  // Validate API key format (basic check)
  if (apiKey.length < 10) {
    print('');
    printError('Invalid API key format. Please check your API key and try again.');
    rl.close();
    process.exit(1);
  }

  // Validate the key against the backend before writing any config, so a bad
  // key is caught now instead of silently failing every tool call later.
  print('');
  printDim('Verifying your API key…');
  const keyCheck = await validateKey(apiKey);
  if (!keyCheck.ok && keyCheck.reason === 'invalid') {
    print('');
    printError('That API key was rejected by ContextForge.');
    printDim('Create a fresh key at https://contextforge.dev/dashboard/api-keys and run npx contextforge-setup again.');
    rl.close();
    process.exit(1);
  }
  if (!keyCheck.ok) {
    printDim('Could not reach ContextForge to verify the key (network). Continuing; run `npx contextforge-setup --verify` later.');
  }

  print('');
  printDim('Configuring ContextForge MCP...');
  print('');

  // Use Claude CLI if available, otherwise show manual instructions
  if (hasClaudeCLI) {
    try {
      // `claude mcp add` refuses to overwrite an existing server, so remove any
      // existing entry first. Ignore the error if it isn't configured yet.
      try {
        execSync('claude mcp remove contextforge', { stdio: 'pipe' });
      } catch {
        // Not configured yet — nothing to remove.
      }

      // Run claude mcp add command
      const command = `claude mcp add contextforge -s user -e CONTEXTFORGE_API_KEY=${apiKey} -- npx -y contextforge-mcp`;

      execSync(command, { stdio: 'inherit' });

      print('');
      print('─'.repeat(60));
      print('');
      printSuccess('ContextForge MCP configured successfully!');
      print('');
      print(`${colors.bright}Next steps:${colors.reset}`);
      print(`  1. Restart Claude Code (or open a new terminal)`);
      print(`  2. Try: ${colors.cyan}"save to memory that I just set up ContextForge"${colors.reset}`);
      print(`  3. Then: ${colors.cyan}"what did I save to memory?"${colors.reset}`);
      print('');
      print(`${colors.dim}Documentation: https://contextforge.dev/docs${colors.reset}`);
      print('');

    } catch (error) {
      print('');
      printError('Failed to configure using Claude CLI.');
      print('');

      // Ask user what to do next
      const choice = await askRetryChoice(rl);

      if (choice === 'retry') {
        // Re-ask for API key and try again
        const newApiKey = await askQuestion(rl, `Enter your ContextForge API key: `);
        if (newApiKey && newApiKey.length >= 10) {
          try {
            // Remove first so the new (different) key overwrites the old entry.
            try {
              execSync('claude mcp remove contextforge', { stdio: 'pipe' });
            } catch {
              // Not configured yet — nothing to remove.
            }
            const retryCommand = `claude mcp add contextforge -s user -e CONTEXTFORGE_API_KEY=${newApiKey} -- npx -y contextforge-mcp`;
            execSync(retryCommand, { stdio: 'inherit' });
            print('');
            print('─'.repeat(60));
            print('');
            printSuccess('ContextForge MCP configured successfully!');
            print('');
            print(`${colors.bright}Next steps:${colors.reset}`);
            print(`  1. Restart Claude Code (or open a new terminal)`);
            print(`  2. Try: ${colors.cyan}"save to memory that I just set up ContextForge"${colors.reset}`);
            print(`  3. Then: ${colors.cyan}"what did I save to memory?"${colors.reset}`);
            print('');
            print(`${colors.dim}Documentation: https://contextforge.dev/docs${colors.reset}`);
            print('');
            rl.close();
            return;
          } catch {
            printError('Configuration failed again.');
            print('');
            printManualInstructions(newApiKey);
          }
        } else {
          printError('Invalid API key. Showing manual instructions.');
          print('');
          printManualInstructions(apiKey);
        }
      } else if (choice === 'manual') {
        printManualInstructions(apiKey);
      } else {
        printDim('Setup cancelled.');
      }
    }
  } else {
    printWarning('Claude CLI not found.');
    print('');
    printManualInstructions(apiKey);
  }

  rl.close();
}

async function askRetryChoice(rl: readline.Interface): Promise<'retry' | 'manual' | 'exit'> {
  print(`What would you like to do?`);
  print(`  ${colors.cyan}1${colors.reset}) Reconfigure with a different API key`);
  print(`  ${colors.cyan}2${colors.reset}) Show manual setup instructions`);
  print(`  ${colors.cyan}3${colors.reset}) Exit`);
  print('');

  const answer = await askQuestion(rl, `Choose an option (1-3): `);

  if (answer === '1' || answer.toLowerCase() === 'reconfigure') {
    return 'retry';
  } else if (answer === '2' || answer.toLowerCase() === 'manual') {
    return 'manual';
  } else {
    return 'exit';
  }
}

function printManualInstructions(apiKey: string) {
  print(`${colors.bright}Manual Setup Instructions:${colors.reset}`);
  print('');
  print(`${colors.cyan}Option 1: Using Claude CLI${colors.reset}`);
  print(`First install Claude CLI, then run:`);
  print('');
  printDim(`  claude mcp remove contextforge   # skip if not yet configured`);
  printDim(`  claude mcp add contextforge -s user -e CONTEXTFORGE_API_KEY=${apiKey} -- npx -y contextforge-mcp`);
  print('');
  print(`${colors.cyan}Option 2: Edit config manually${colors.reset}`);
  print(`Add to your claude_desktop_config.json:`);
  print('');

  const configSnippet = {
    mcpServers: {
      contextforge: {
        command: 'npx',
        args: ['-y', 'contextforge-mcp'],
        env: {
          CONTEXTFORGE_API_KEY: apiKey
        }
      }
    }
  };

  printDim(JSON.stringify(configSnippet, null, 2));
  print('');

  const configPath = getClaudeConfigPath();
  printDim(`Config location: ${configPath}`);
  print('');
  print(`${colors.dim}Documentation: https://contextforge.dev/docs/mcp-native${colors.reset}`);
  print('');
}

// ============ Verify Command ============
async function runVerify() {
  printBanner();

  print(`Checking ContextForge configuration...`);
  print('');

  const desktopConfig = checkExistingConfig();
  const hasClaudeCLI = checkClaudeCLI();
  const cliConfig = hasClaudeCLI ? checkClaudeCodeConfig() : { configured: false };

  // Determine if configured in either location
  const isConfigured = desktopConfig.hasContextForge || cliConfig.configured;

  print(`${colors.cyan}Claude CLI:${colors.reset} ${hasClaudeCLI ? colors.green + 'Found' : colors.yellow + 'Not found'}${colors.reset}`);

  if (hasClaudeCLI) {
    const cliStatus = cliConfig.configured
      ? `${colors.green}Configured${colors.reset}${cliConfig.scope ? ` (${cliConfig.scope})` : ''}`
      : `${colors.yellow}Not configured${colors.reset}`;
    print(`${colors.cyan}Claude Code MCP:${colors.reset} ${cliStatus}`);
  }

  print(`${colors.cyan}Desktop config:${colors.reset} ${desktopConfig.exists ? (desktopConfig.hasContextForge ? colors.green + 'Configured' : colors.yellow + 'Found (no ContextForge)') : colors.dim + 'Not found'}${colors.reset}`);
  print('');

  if (isConfigured) {
    printSuccess('ContextForge MCP is configured and ready!');
    if (cliConfig.configured && cliConfig.scopes) {
      if (cliConfig.scopes.length > 1) {
        printDim(`Configured via Claude Code CLI (${cliConfig.scopes.join(' + ')} scope)`);
      } else {
        printDim(`Configured via Claude Code CLI (${cliConfig.scope} scope)`);
      }
    }
    if (desktopConfig.hasContextForge) {
      printDim(`Configured in Claude Desktop config`);
    }
  } else {
    printWarning('ContextForge MCP is not configured.');
    print(`Run ${colors.cyan}npx contextforge-setup${colors.reset} to configure.`);
  }
  print('');
}

// ============ Main ============
const args = process.argv.slice(2);

if (args.includes('--verify') || args.includes('-v')) {
  runVerify();
} else if (args.includes('--help') || args.includes('-h')) {
  printBanner();
  print(`${colors.bright}Usage:${colors.reset}`);
  print(`  npx contextforge-setup          Run the setup wizard`);
  print(`  npx contextforge-setup --verify Check current configuration`);
  print(`  npx contextforge-setup --help   Show this help`);
  print('');
  print(`${colors.bright}More info:${colors.reset}`);
  print(`  https://contextforge.dev/docs`);
  print('');
} else {
  runSetup();
}
