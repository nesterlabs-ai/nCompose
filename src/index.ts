#!/usr/bin/env node
import 'dotenv/config';
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { spawn } from 'child_process';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { convertFigmaToCode } from './convert.js';
import { writeOutputFiles } from './output.js';
import { setupPreview, getPreviewUrl, cleanPreviewApp } from './preview/setup-preview.js';
import { wireIntoStarter } from './template/wire-into-starter.js';
import { generateSessionId } from './utils/session-id.js';
import {
  SUPPORTED_FRAMEWORKS,
  SUPPORTED_LLM_PROVIDERS,
} from './types/index.js';
import type { Framework, LLMProviderName } from './types/index.js';
import { config } from './config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const program = new Command();

program
  .name('ncompose')
  .description('Convert Figma designs to import-ready code for React, Vue, Svelte, Angular, and Solid')
  .version('0.1.0');

program
  .command('convert')
  .description('Convert a Figma URL to framework code')
  .argument('<figma-url>', 'Figma file or frame URL (with optional ?node-id=)')
  .option(
    '-f, --frameworks <frameworks>',
    `Comma-separated target frameworks (${SUPPORTED_FRAMEWORKS.join(', ')})`,
    config.cli.defaultFrameworks,
  )
  .option('-o, --output <dir>', 'Output directory', config.cli.defaultOutput)
  .option('-n, --name <name>', 'Component name (auto-detected from Figma if omitted)')
  .option(
    '--llm <provider>',
    `LLM provider (${SUPPORTED_LLM_PROVIDERS.join(', ')})`,
    config.cli.defaultLLM,
  )
  .option('--depth <number>', 'Figma tree depth limit', config.cli.defaultDepth)
  .option('--template', 'Use starter template styling (Tailwind + cn() + CSS variables)', false)
  .option('--preview', 'Set up preview app and show URL', false)
  .action(async (figmaUrl: string, opts) => {
    // Validate frameworks
    const frameworks = opts.frameworks
      .split(',')
      .map((f: string) => f.trim().toLowerCase()) as Framework[];

    for (const fw of frameworks) {
      if (!SUPPORTED_FRAMEWORKS.includes(fw)) {
        console.error(
          chalk.red(`Unknown framework: "${fw}". Supported: ${SUPPORTED_FRAMEWORKS.join(', ')}`),
        );
        process.exit(1);
      }
    }

    // Validate LLM provider
    const llm = opts.llm.toLowerCase() as LLMProviderName;
    if (!SUPPORTED_LLM_PROVIDERS.includes(llm)) {
      console.error(
        chalk.red(`Unknown LLM provider: "${opts.llm}". Supported: ${SUPPORTED_LLM_PROVIDERS.join(', ')}`),
      );
      process.exit(1);
    }

    const spinner = ora();

    try {
      console.log(chalk.bold('\nFigma → Code Pipeline\n'));

      // Generate unique session ID for this run
      const sessionId = generateSessionId();
      console.log(chalk.dim(`Session ID: ${sessionId}\n`));

      const result = await convertFigmaToCode(
        figmaUrl,
        {
          frameworks,
          output: opts.output,
          name: opts.name,
          llm,
          depth: parseInt(opts.depth, 10),
          templateMode: opts.template === true,
        },
        {
          onStep: (step) => {
            spinner.start(step);
          },
          onAttempt: (attempt, maxRetries, error) => {
            if (error) {
              spinner.warn(`Attempt ${attempt}/${maxRetries} failed: ${error}`);
              spinner.start(`Retrying (${attempt + 1}/${maxRetries})...`);
            }
          },
        },
      );

      spinner.succeed('Code generated successfully!');

      // Write output files - organize by component name and session ID
      const componentOutputDir = join(opts.output, `${result.componentName}-${sessionId}`);
      const writtenPaths = writeOutputFiles({
        outputDir: componentOutputDir,
        componentName: result.componentName,
        mitosisSource: result.mitosisSource,
        frameworkOutputs: result.frameworkOutputs,
        assets: result.assets,
        componentPropertyDefinitions: result.componentPropertyDefinitions,
        variantMetadata: result.variantMetadata,
        fidelityReport: result.fidelityReport,
      });

      // Print summary
      console.log(chalk.bold('\nOutput files:'));
      for (const filePath of writtenPaths) {
        console.log(chalk.green(`  ✓ ${filePath}`));
      }

      console.log(chalk.bold.green(`\nDone! ${writtenPaths.length} files written to ${componentOutputDir}/\n`));

      // Wire into starter template when --template
      if (opts.template) {
        const projectRoot = join(__dirname, '..');
        const starterDir = join(projectRoot, 'src', 'figma-to-code-starter-main');
        if (existsSync(starterDir)) {
          try {
            // Build figmaVariantNames from variant metadata for filtering non-existent combos
            const figmaVariantNames = result.variantMetadata?.variants?.map((v: { props: Record<string, string> }) =>
              Object.entries(v.props).map(([k, val]) => `${k}=${val}`).join(', ')
            );
            const appDir = wireIntoStarter({
              componentOutputDir: componentOutputDir,
              componentName: result.componentName,
              starterDir,
              componentPropertyDefinitions: result.componentPropertyDefinitions,
              figmaVariantNames,
            });
            console.log(chalk.bold.cyan('Template wired: runnable app in'));
            console.log(chalk.cyan(`  ${appDir}\n`));
            console.log(chalk.dim('  cd ' + appDir + ' && npm install && npm run dev\n'));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(chalk.yellow('⚠ Template wiring failed: ' + msg + '\n'));
          }
        } else {
          console.warn(chalk.yellow(`⚠ Starter template not found at ${starterDir}. Skipping template wiring.\n`));
        }
      }

      // Set up preview if requested
      if (opts.preview) {
        console.log(chalk.bold('\nSetting up preview...\n'));

        // Find preview-app directory (should be sibling to package root)
        const projectRoot = join(__dirname, '..');
        const previewAppDir = join(projectRoot, '..', 'preview-app');

        if (!existsSync(previewAppDir)) {
          console.warn(chalk.yellow('⚠ preview-app directory not found. Skipping preview setup.'));
          console.log(chalk.dim(`  Expected: ${previewAppDir}\n`));
        } else {
          // Clean preview app first to avoid old CSS/script interference
          // Archive old components before cleaning for backup/comparison
          cleanPreviewApp(previewAppDir, { archive: true });

          // Set up preview
          const reactOutputPath = join(componentOutputDir, `${result.componentName}.jsx`);
          const assetsDir = join(componentOutputDir, 'assets');
          const metadataPath = join(componentOutputDir, `${result.componentName}.meta.json`);

          await setupPreview({
            componentName: result.componentName,
            componentPath: reactOutputPath,
            assetsDir: existsSync(assetsDir) ? assetsDir : undefined,
            previewAppDir,
            componentPropertyDefinitions: result.componentPropertyDefinitions,
            metadataPath: existsSync(metadataPath) ? metadataPath : undefined,
          });

          // Check if dev server is running
          const previewUrl = getPreviewUrl(config.preview.port);
          console.log(chalk.bold.cyan(`\n📱 Preview URL: ${previewUrl}\n`));
          console.log(chalk.dim('   Start preview with: cd ../preview-app && npm run dev\n'));
        }
      }
    } catch (error) {
      spinner.fail('Pipeline failed');
      const msg = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`\nError: ${msg}\n`));
      process.exit(1);
    }
  });

program.parse();
