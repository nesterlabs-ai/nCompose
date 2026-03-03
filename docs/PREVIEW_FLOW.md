# Preview Flow Documentation

## Overview

The figma-to-mitosis pipeline now includes automated preview setup. When you generate a component, you can optionally set up the preview app to display all variants automatically.

## Folder Structure

```
Figma-to-Mitosis Pipeline/
├── figma-to-mitosis/          # Main package
│   ├── src/
│   │   ├── preview/
│   │   │   └── setup-preview.ts   # Preview setup utility
│   │   ├── utils/
│   │   │   └── session-id.ts      # Unique ID generator
│   │   └── index.ts               # CLI with --preview flag
│   └── output/                     # Generated output (gitignored)
│       └── <ComponentName>-<SessionID>/   # Unique per run
│           ├── <ComponentName>.lite.tsx
│           ├── <ComponentName>.jsx
│           ├── <ComponentName>.vue
│           ├── <ComponentName>.svelte
│           ├── <ComponentName>.ts  (Angular)
│           ├── <ComponentName>.tsx (Solid)
│           └── assets/
│               └── *.svg
│
└── preview-app/                # Preview React app (cleaned each run)
    ├── src/
    │   ├── components/         # Auto-cleaned, then component copied
    │   │   └── <ComponentName>.jsx
    │   ├── App.jsx             # Auto-generated to display component
    │   └── main.jsx
    └── public/
        └── assets/             # Auto-cleaned, then assets copied
            └── *.svg
```

**Session ID Format:** `YYYYMMDD-HHMMSS` (e.g., `20240224-153045`)

## Usage

### Basic Flow (No Preview)

```bash
npm run dev -- convert "https://www.figma.com/..." -f react -o ./output
```

**What happens:**
1. Fetches Figma data
2. Generates component code
3. Writes files to `./output/<ComponentName>/`
4. Prints file list

**Output:**
```
output/
└── ButtonDanger-20240224-153045/    # Unique session ID
    ├── ButtonDanger.lite.tsx
    ├── ButtonDanger.jsx
    └── assets/
        └── star.svg
```

**Benefit:** Each run creates a new folder, preserving history. You can compare outputs across runs.

### With Preview

```bash
npm run dev -- convert "https://www.figma.com/..." -f react --preview -o ./output
```

**What happens:**
1. Fetches Figma data
2. Generates component code
3. Writes files to `./output/<ComponentName>/`
4. **Sets up preview app:**
   - Copies `<ComponentName>.jsx` → `preview-app/src/components/`
   - Copies `assets/*.svg` → `preview-app/public/assets/`
   - Generates `preview-app/src/App.jsx` to display all variants
5. Prints preview URL

**Output:**
```
output/
└── ButtonDanger-20240224-153045/    # Unique session ID
    ├── ButtonDanger.lite.tsx
    ├── ButtonDanger.jsx
    └── assets/
        └── star.svg

preview-app/                         # Cleaned before setup
├── src/
│   ├── components/
│   │   └── ButtonDanger.jsx        # Old components removed, new copied
│   └── App.jsx                     # Auto-generated fresh
└── public/
    └── assets/
        └── star.svg                # Old assets removed, new copied
```

**Automatic Cleanup:**
- Before setting up preview, **all old components** (`.jsx`, `.tsx`) are removed from `preview-app/src/components/`
- All old assets (`.svg`, `.png`, `.jpg`) are removed from `preview-app/public/assets/`
- This prevents CSS conflicts and old scripts from interfering with new components

**CLI Output:**
```
✓ Copied component to preview-app/src/components/ButtonDanger.jsx
✓ Copied 1 asset(s) to preview-app/public/assets
✓ Updated preview-app/src/App.jsx

📱 Preview URL: http://localhost:5173

   Start preview with: cd ../preview-app && npm run dev
```

## Starting the Preview

### First Time Setup

```bash
cd ../preview-app
npm install
npm run dev
```

### Subsequent Runs

If the dev server is already running:
1. Generate new component with `--preview` flag
2. Preview app hot-reloads automatically
3. Open the URL shown in CLI output

If dev server is stopped:
```bash
cd ../preview-app
npm run dev
```

## What Gets Generated in App.jsx

The preview automatically shows:

1. **All Variants Grid**
   - Every combination of variant axes (Style × Size × State)
   - For ButtonDanger: 3 styles × 2 sizes × 5 states = 30 variants

2. **Component Properties**
   - Uses actual Figma icons and text
   - Shows all extracted component properties in action

3. **Responsive Layout**
   - Grid automatically adjusts to screen size
   - Cards show variant label + rendered component

## Example Generated App.jsx

```jsx
import ButtonDanger from './components/ButtonDanger'

const allVariants = [
  { label: 'subtle / medium / Default', props: {} },
  { label: 'subtle / medium / Hover', props: { hover: true } },
  { label: 'subtle / medium / Focus', props: { focus: true } },
  // ... 27 more variants
]

function App() {
  return (
    <div>
      <h1>ButtonDanger</h1>
      {allVariants.map((v) => (
        <div key={v.label}>
          <div>{v.label}</div>
          <ButtonDanger {...v.props}>Button</ButtonDanger>
        </div>
      ))}
    </div>
  )
}
```

## Cleanup

### Remove Generated Files

```bash
# Remove output
rm -rf output/

# Clean preview app (keeps installed node_modules)
rm -rf preview-app/src/components/*
rm -rf preview-app/public/assets/*
```

### .gitignore

The following are already gitignored:
```
# figma-to-mitosis/
output/

# preview-app/
src/components/*.jsx  (except examples)
public/assets/*.svg
```

## Advanced Usage

### Custom Output Directory

```bash
npm run dev -- convert "..." --preview -o ./my-components
```

Preview setup will still use the generated React component from `./my-components/<Name>.jsx`.

### Multiple Frameworks

```bash
npm run dev -- convert "..." -f react,vue,svelte --preview
```

Preview uses React component (`.jsx`). Other frameworks are generated but not previewed.

### Preview Without Regenerating

If you just want to update the preview without regenerating:

1. Manually copy component:
   ```bash
   cp output/ButtonDanger/ButtonDanger.jsx ../preview-app/src/components/
   cp output/ButtonDanger/assets/* ../preview-app/public/assets/
   ```

2. Update `preview-app/src/App.jsx` to import your component

## Troubleshooting

### Preview app not found

```
⚠ preview-app directory not found. Skipping preview setup.
  Expected: /Users/.../Figma-to-Mitosis Pipeline/preview-app
```

**Solution:** Make sure `preview-app/` exists as a sibling to `figma-to-mitosis/`.

### Port already in use

```
Port 5173 is in use, trying another one...
  ➜  Local:   http://localhost:5174/
```

**Solution:** Use the new port shown in the output. CLI will still show default (5173).

### Assets not showing

**Check:**
1. Assets were exported: `ls output/<Name>/assets/`
2. Assets were copied: `ls preview-app/public/assets/`
3. Component references correct path: `/assets/star.svg` (not `./assets/`)

### Hot reload not working

**Solution:** Restart dev server:
```bash
# In preview-app/
npm run dev
```

## Integration with CI/CD

For automated testing/deployment:

```bash
# Generate with preview
npm run dev -- convert "..." --preview

# Start preview in background
cd ../preview-app && npm run dev &

# Wait for server to start
sleep 3

# Run visual regression tests
npm run test:visual

# Stop preview server
pkill -f "vite"
```

## Next Steps

- [ ] Add visual regression testing
- [ ] Support custom preview templates
- [ ] Add interactive prop controls
- [ ] Generate preview for all frameworks (not just React)
- [ ] Add screenshot generation for documentation
