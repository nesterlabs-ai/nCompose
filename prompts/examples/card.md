### Example: Card Component

**Input:**
```yaml
nodes:
  - id: "2:1"
    name: "Card"
    type: FRAME
    layout: layout_010
    fills: fill_010
    borderRadius: "12px"
    effects: effect_010
    children:
      - id: "2:2"
        name: "CardImage"
        type: RECTANGLE
        layout: layout_011
        fills: fill_011
        borderRadius: "8px"
      - id: "2:3"
        name: "Title"
        type: TEXT
        text: "Modern Dashboard"
        textStyle: text_010
        fills: fill_012
        layout: layout_012
      - id: "2:4"
        name: "Description"
        type: TEXT
        text: "A clean and intuitive analytics dashboard for your team."
        textStyle: text_011
        fills: fill_013
        layout: layout_012
      - id: "2:5"
        name: "LearnMore"
        type: FRAME
        layout: layout_013
        fills: fill_014
        borderRadius: "6px"
        children:
          - id: "2:6"
            name: "ButtonLabel"
            type: TEXT
            text: "Learn More"
            textStyle: text_012
            fills: fill_015
            layout: layout_014
globalVars:
  styles:
    layout_010:
      mode: column
      alignItems: flex-start
      gap: "16px"
      padding: "0px"
      sizing:
        horizontal: fixed
        vertical: hug
      dimensions:
        width: 320
    layout_011:
      sizing:
        horizontal: fill
        vertical: fixed
      dimensions:
        height: 180
    layout_012:
      sizing:
        horizontal: fill
        vertical: hug
    layout_013:
      mode: row
      justifyContent: center
      alignItems: center
      padding: "10px 20px"
      sizing:
        horizontal: fill
        vertical: hug
    layout_014:
      sizing:
        horizontal: hug
        vertical: hug
    fill_010:
      - "#FFFFFF"
    fill_011:
      - type: IMAGE
        imageRef: "img_placeholder"
        scaleMode: FILL
        objectFit: cover
    fill_012:
      - "#111827"
    fill_013:
      - "#6B7280"
    fill_014:
      - "#3B82F6"
    fill_015:
      - "#FFFFFF"
    text_010:
      fontFamily: Inter
      fontWeight: 700
      fontSize: 20
      lineHeight: 1.4em
    text_011:
      fontFamily: Inter
      fontWeight: 400
      fontSize: 14
      lineHeight: 1.5em
    text_012:
      fontFamily: Inter
      fontWeight: 600
      fontSize: 14
      lineHeight: 1.5em
      textAlignHorizontal: CENTER
    effect_010:
      boxShadow: "0px 1px 3px 0px rgba(0, 0, 0, 0.1), 0px 1px 2px -1px rgba(0, 0, 0, 0.1)"
```

**Output:**
```tsx
import { useStore } from '@builder.io/mitosis';

export default function Card(props) {
  return (
    <div
      css={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: '16px',
        width: '320px',
        backgroundColor: '#FFFFFF',
        borderRadius: '12px',
        boxShadow: '0px 1px 3px 0px rgba(0, 0, 0, 0.1), 0px 1px 2px -1px rgba(0, 0, 0, 0.1)',
        overflow: 'hidden',
      }}
    >
      <div
        css={{
          width: '100%',
          height: '180px',
          backgroundColor: '#E5E7EB',
          borderRadius: '8px',
          objectFit: 'cover',
        }}
      />
      <div css={{ padding: '0px 16px', display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', boxSizing: 'border-box' }}>
        <h3
          css={{
            fontFamily: 'Inter',
            fontWeight: '700',
            fontSize: '20px',
            lineHeight: '1.4em',
            color: '#111827',
            margin: '0',
          }}
        >
          Modern Dashboard
        </h3>
        <p
          css={{
            fontFamily: 'Inter',
            fontWeight: '400',
            fontSize: '14px',
            lineHeight: '1.5em',
            color: '#6B7280',
            margin: '0',
          }}
        >
          A clean and intuitive analytics dashboard for your team.
        </p>
      </div>
      <div css={{ padding: '0px 16px 16px 16px', width: '100%', boxSizing: 'border-box' }}>
        <button
          css={{
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'center',
            alignItems: 'center',
            padding: '10px 20px',
            width: '100%',
            backgroundColor: '#3B82F6',
            borderRadius: '6px',
            border: 'none',
            cursor: 'pointer',
          }}
        >
          <span
            css={{
              fontFamily: 'Inter',
              fontWeight: '600',
              fontSize: '14px',
              lineHeight: '1.5em',
              color: '#FFFFFF',
              textAlign: 'center',
            }}
          >
            Learn More
          </span>
        </button>
      </div>
    </div>
  );
}
```
