# coremanual.link

A static site generator for documentation and blog posts, built with Astro and Markdown.

## Features

- 📝 Write blog posts in Markdown
- 📚 Create documentation pages in Markdown
- 🚀 Fast static site generation
- 🎨 Clean, responsive design
- 🌙 Automatic dark mode support
- 🔍 SEO-friendly with sitemap generation

## Quick Start

### Installation

```bash
npm install
npm run setup  # Creates symlinks so you can work in coremanual.link/ directory
```

### Development

Start the development server:

```bash
npm run dev
```

Visit `http://localhost:4321` to see your site.

### Building

Build the site for production:

```bash
npm run build
```

The output will be in the `dist/` directory.

### Preview Production Build

Preview the production build locally:

```bash
npm run preview
```

## Content Structure

**Note**: You can work in either `src/content/` (standard Astro location) or `coremanual.link/` (after running `npm run setup`). Both locations point to the same files.

### Blog Posts

Add blog posts as Markdown files in `src/content/blog/` (or `coremanual.link/blog/`):

```markdown
---
title: My Blog Post
description: A brief description
date: 2024-01-15
author: Your Name
tags: [tag1, tag2]
draft: false
---

# My Blog Post

Your content here...
```

### Documentation

Add documentation pages as Markdown files in `src/content/docs/` (or `coremanual.link/docs/`):

```markdown
---
title: Page Title
description: Optional description
order: 10
---

# Page Title

Your documentation content...
```

## Project Structure

```
.
├── src/
│   ├── content/        # Content collections
│   │   ├── blog/      # Blog posts (markdown)
│   │   └── docs/      # Documentation (markdown)
│   ├── layouts/        # Layout components
│   └── pages/          # Page routes
├── public/             # Static assets
└── dist/               # Build output (generated)
```

## Frontmatter Options

### Blog Posts

- `title` (required): Post title
- `description` (optional): Post description/excerpt
- `date` (required): Publication date (YYYY-MM-DD)
- `author` (optional): Author name
- `tags` (optional): Array of tags
- `draft` (optional): Set to `true` to hide in production

### Documentation

- `title` (required): Page title
- `description` (optional): Page description
- `order` (optional): Display order (lower numbers appear first)

## Deployment

The site can be deployed to any static hosting service:

- **Netlify**: Connect your repository and deploy automatically
- **Vercel**: Import your repository and deploy
- **GitHub Pages**: Use GitHub Actions to build and deploy
- **Cloudflare Pages**: Connect and deploy

## Customization

### Styling

Edit `src/layouts/BaseLayout.astro` to customize the site's appearance.

### Configuration

Edit `astro.config.mjs` to configure Astro settings, site URL, and integrations.

## License

MIT

