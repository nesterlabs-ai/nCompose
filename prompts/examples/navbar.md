### Example: Navigation Bar

**Input:**
```yaml
nodes:
  - id: "3:1"
    name: "Navbar"
    type: FRAME
    layout: layout_020
    fills: fill_020
    strokes: stroke_020
    strokeWeight: "0px 0px 1px 0px"
    children:
      - id: "3:2"
        name: "Logo"
        type: TEXT
        text: "Acme Inc"
        textStyle: text_020
        fills: fill_021
        layout: layout_021
      - id: "3:3"
        name: "NavLinks"
        type: FRAME
        layout: layout_022
        children:
          - id: "3:4"
            name: "Link"
            type: TEXT
            text: "Features"
            textStyle: text_021
            fills: fill_022
            layout: layout_021
          - id: "3:5"
            name: "Link"
            type: TEXT
            text: "Pricing"
            textStyle: text_021
            fills: fill_022
            layout: layout_021
          - id: "3:6"
            name: "Link"
            type: TEXT
            text: "About"
            textStyle: text_021
            fills: fill_022
            layout: layout_021
      - id: "3:7"
        name: "CTAButton"
        type: FRAME
        layout: layout_023
        fills: fill_023
        borderRadius: "6px"
        children:
          - id: "3:8"
            name: "Label"
            type: TEXT
            text: "Sign Up"
            textStyle: text_022
            fills: fill_024
            layout: layout_021
globalVars:
  styles:
    layout_020:
      mode: row
      justifyContent: space-between
      alignItems: center
      padding: "16px 32px"
      sizing:
        horizontal: fill
        vertical: hug
    layout_021:
      sizing:
        horizontal: hug
        vertical: hug
    layout_022:
      mode: row
      alignItems: center
      gap: "32px"
      sizing:
        horizontal: hug
        vertical: hug
    layout_023:
      mode: row
      justifyContent: center
      alignItems: center
      padding: "8px 16px"
      sizing:
        horizontal: hug
        vertical: hug
    fill_020:
      - "#FFFFFF"
    fill_021:
      - "#111827"
    fill_022:
      - "#4B5563"
    fill_023:
      - "#111827"
    fill_024:
      - "#FFFFFF"
    text_020:
      fontFamily: Inter
      fontWeight: 700
      fontSize: 20
      lineHeight: 1.4em
    text_021:
      fontFamily: Inter
      fontWeight: 500
      fontSize: 16
      lineHeight: 1.5em
    text_022:
      fontFamily: Inter
      fontWeight: 600
      fontSize: 14
      lineHeight: 1.5em
      textAlignHorizontal: CENTER
    stroke_020:
      colors:
        - "#E5E7EB"
```

**Output:**
```tsx
export default function Navbar(props) {
  return (
    <nav class="navbar">
      <span class="navbar__logo">Acme Inc</span>
      <div class="navbar__links">
        <a class="navbar__link">Features</a>
        <a class="navbar__link">Pricing</a>
        <a class="navbar__link">About</a>
      </div>
      <button class="navbar__cta" type="button">Sign Up</button>
    </nav>
  );
}
---CSS---
.navbar {
  display: flex;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  padding: 16px 32px;
  width: 100%;
  background-color: #FFFFFF;
  border-bottom: 1px solid #E5E7EB;
  box-sizing: border-box;
}
.navbar__logo {
  font-family: Inter;
  font-weight: 700;
  font-size: 20px;
  line-height: 1.4em;
  color: #111827;
}
.navbar__links {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 32px;
}
.navbar__link {
  font-family: Inter;
  font-weight: 500;
  font-size: 16px;
  line-height: 1.5em;
  color: #4B5563;
  text-decoration: none;
}
.navbar__cta {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 8px 16px;
  background-color: #111827;
  border-radius: 6px;
  border: none;
  cursor: pointer;
  font-family: Inter;
  font-weight: 600;
  font-size: 14px;
  line-height: 1.5em;
  color: #FFFFFF;
  text-align: center;
}
```
