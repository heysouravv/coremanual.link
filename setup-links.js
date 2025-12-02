#!/usr/bin/env node

import { symlink, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const coremanualDir = join(__dirname, 'coremanual.link');
const blogSource = join(__dirname, 'src', 'content', 'blog');
const docsSource = join(__dirname, 'src', 'content', 'docs');
const blogLink = join(coremanualDir, 'blog');
const docsLink = join(coremanualDir, 'docs');

async function setupLinks() {
  try {
    // Create coremanual.link directory if it doesn't exist
    if (!existsSync(coremanualDir)) {
      await mkdir(coremanualDir, { recursive: true });
      console.log('✓ Created coremanual.link directory');
    }

    // Create symlinks
    if (!existsSync(blogLink)) {
      await symlink(blogSource, blogLink, 'dir');
      console.log('✓ Created symlink: coremanual.link/blog -> src/content/blog');
    } else {
      console.log('⚠ coremanual.link/blog already exists');
    }

    if (!existsSync(docsLink)) {
      await symlink(docsSource, docsLink, 'dir');
      console.log('✓ Created symlink: coremanual.link/docs -> src/content/docs');
    } else {
      console.log('⚠ coremanual.link/docs already exists');
    }

    console.log('\n✓ Setup complete! You can now work in either:');
    console.log('  - src/content/blog/ and src/content/docs/');
    console.log('  - coremanual.link/blog/ and coremanual.link/docs/');
    console.log('\nBoth locations point to the same files.');
  } catch (error) {
    if (error.code === 'EEXIST') {
      console.log('⚠ Symlinks already exist');
    } else {
      console.error('Error setting up links:', error.message);
      process.exit(1);
    }
  }
}

setupLinks();

