### Example: Simple Button

**Input:**
```yaml
nodes:
  - id: "1:2"
    name: "PrimaryButton"
    type: FRAME
    layout: layout_001
    fills: fill_001
    borderRadius: "8px"
    children:
      - id: "1:3"
        name: "Label"
        type: TEXT
        text: "Get Started"
        textStyle: text_001
        fills: fill_002
        layout: layout_002
globalVars:
  styles:
    layout_001:
      mode: row
      justifyContent: center
      alignItems: center
      padding: "12px 24px"
      sizing:
        horizontal: hug
        vertical: hug
    layout_002:
      sizing:
        horizontal: hug
        vertical: hug
    fill_001:
      - "#3B82F6"
    fill_002:
      - "#FFFFFF"
    text_001:
      fontFamily: Inter
      fontWeight: 600
      fontSize: 16
      lineHeight: 1.5em
      textAlignHorizontal: CENTER
```

**Output:**
```tsx
import { useStore } from '@builder.io/mitosis';

export default function PrimaryButton(props) {
  return (
    <button
      css={{
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '12px 24px',
        backgroundColor: '#3B82F6',
        borderRadius: '8px',
        border: 'none',
        cursor: 'pointer',
      }}
    >
      <span
        css={{
          fontFamily: 'Inter',
          fontWeight: '600',
          fontSize: '16px',
          lineHeight: '1.5em',
          color: '#FFFFFF',
          textAlign: 'center',
        }}
      >
        Get Started
      </span>
    </button>
  );
}
```
