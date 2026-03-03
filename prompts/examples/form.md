### Example: Contact Form

**Input:**
```yaml
nodes:
  - id: "4:1"
    name: "ContactForm"
    type: FRAME
    layout: layout_030
    fills: fill_030
    borderRadius: "12px"
    effects: effect_030
    children:
      - id: "4:2"
        name: "FormTitle"
        type: TEXT
        text: "Contact Us"
        textStyle: text_030
        fills: fill_031
        layout: layout_031
      - id: "4:3"
        name: "NameField"
        type: FRAME
        layout: layout_032
        children:
          - id: "4:4"
            name: "NameLabel"
            type: TEXT
            text: "Full Name"
            textStyle: text_031
            fills: fill_032
            layout: layout_031
          - id: "4:5"
            name: "NameInput"
            type: FRAME
            layout: layout_033
            fills: fill_030
            strokes: stroke_030
            borderRadius: "6px"
            children:
              - id: "4:6"
                name: "Placeholder"
                type: TEXT
                text: "Enter your name"
                textStyle: text_032
                fills: fill_033
                layout: layout_031
      - id: "4:7"
        name: "EmailField"
        type: FRAME
        layout: layout_032
        children:
          - id: "4:8"
            name: "EmailLabel"
            type: TEXT
            text: "Email Address"
            textStyle: text_031
            fills: fill_032
            layout: layout_031
          - id: "4:9"
            name: "EmailInput"
            type: FRAME
            layout: layout_033
            fills: fill_030
            strokes: stroke_030
            borderRadius: "6px"
            children:
              - id: "4:10"
                name: "Placeholder"
                type: TEXT
                text: "you@example.com"
                textStyle: text_032
                fills: fill_033
                layout: layout_031
      - id: "4:11"
        name: "MessageField"
        type: FRAME
        layout: layout_032
        children:
          - id: "4:12"
            name: "MessageLabel"
            type: TEXT
            text: "Message"
            textStyle: text_031
            fills: fill_032
            layout: layout_031
          - id: "4:13"
            name: "MessageInput"
            type: FRAME
            layout: layout_034
            fills: fill_030
            strokes: stroke_030
            borderRadius: "6px"
            children:
              - id: "4:14"
                name: "Placeholder"
                type: TEXT
                text: "Write your message..."
                textStyle: text_032
                fills: fill_033
                layout: layout_031
      - id: "4:15"
        name: "SubmitButton"
        type: FRAME
        layout: layout_035
        fills: fill_034
        borderRadius: "8px"
        children:
          - id: "4:16"
            name: "ButtonLabel"
            type: TEXT
            text: "Send Message"
            textStyle: text_033
            fills: fill_035
            layout: layout_031
globalVars:
  styles:
    layout_030:
      mode: column
      alignItems: stretch
      gap: "20px"
      padding: "32px"
      sizing:
        horizontal: fixed
        vertical: hug
      dimensions:
        width: 400
    layout_031:
      sizing:
        horizontal: hug
        vertical: hug
    layout_032:
      mode: column
      alignItems: stretch
      gap: "6px"
      sizing:
        horizontal: fill
        vertical: hug
    layout_033:
      mode: row
      alignItems: center
      padding: "10px 12px"
      sizing:
        horizontal: fill
        vertical: hug
    layout_034:
      mode: column
      alignItems: flex-start
      padding: "10px 12px"
      sizing:
        horizontal: fill
        vertical: fixed
      dimensions:
        height: 120
    layout_035:
      mode: row
      justifyContent: center
      alignItems: center
      padding: "12px 24px"
      sizing:
        horizontal: fill
        vertical: hug
    fill_030:
      - "#FFFFFF"
    fill_031:
      - "#111827"
    fill_032:
      - "#374151"
    fill_033:
      - "#9CA3AF"
    fill_034:
      - "#3B82F6"
    fill_035:
      - "#FFFFFF"
    text_030:
      fontFamily: Inter
      fontWeight: 700
      fontSize: 24
      lineHeight: 1.3em
    text_031:
      fontFamily: Inter
      fontWeight: 500
      fontSize: 14
      lineHeight: 1.5em
    text_032:
      fontFamily: Inter
      fontWeight: 400
      fontSize: 14
      lineHeight: 1.5em
    text_033:
      fontFamily: Inter
      fontWeight: 600
      fontSize: 16
      lineHeight: 1.5em
      textAlignHorizontal: CENTER
    stroke_030:
      colors:
        - "#D1D5DB"
    effect_030:
      boxShadow: "0px 4px 6px -1px rgba(0, 0, 0, 0.1), 0px 2px 4px -2px rgba(0, 0, 0, 0.1)"
```

**Output:**
```tsx
import { useStore } from '@builder.io/mitosis';

export default function ContactForm(props) {
  const state = useStore({
    name: '',
    email: '',
    message: '',
  });

  return (
    <form class="contact-form">
      <h2 class="contact-form__title">Contact Us</h2>
      <div class="contact-form__field">
        <label class="contact-form__label">Full Name</label>
        <input
          class="contact-form__input"
          type="text"
          placeholder="Enter your name"
          value={state.name}
          onChange={(event) => (state.name = event.target.value)}
        />
      </div>
      <div class="contact-form__field">
        <label class="contact-form__label">Email Address</label>
        <input
          class="contact-form__input"
          type="email"
          placeholder="you@example.com"
          value={state.email}
          onChange={(event) => (state.email = event.target.value)}
        />
      </div>
      <div class="contact-form__field">
        <label class="contact-form__label">Message</label>
        <textarea
          class="contact-form__textarea"
          placeholder="Write your message..."
          value={state.message}
          onChange={(event) => (state.message = event.target.value)}
        />
      </div>
      <button class="contact-form__submit" type="submit">Send Message</button>
    </form>
  );
}
---CSS---
.contact-form {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 20px;
  padding: 32px;
  width: 400px;
  background-color: #FFFFFF;
  border-radius: 12px;
  box-shadow: 0px 4px 6px -1px rgba(0, 0, 0, 0.1), 0px 2px 4px -2px rgba(0, 0, 0, 0.1);
  box-sizing: border-box;
}
.contact-form__title {
  font-family: Inter;
  font-weight: 700;
  font-size: 24px;
  line-height: 1.3em;
  color: #111827;
  margin: 0;
}
.contact-form__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  width: 100%;
}
.contact-form__label {
  font-family: Inter;
  font-weight: 500;
  font-size: 14px;
  line-height: 1.5em;
  color: #374151;
}
.contact-form__input {
  padding: 10px 12px;
  width: 100%;
  background-color: #FFFFFF;
  border: 1px solid #D1D5DB;
  border-radius: 6px;
  font-family: Inter;
  font-weight: 400;
  font-size: 14px;
  line-height: 1.5em;
  color: #111827;
  box-sizing: border-box;
  outline: none;
}
.contact-form__textarea {
  padding: 10px 12px;
  width: 100%;
  height: 120px;
  background-color: #FFFFFF;
  border: 1px solid #D1D5DB;
  border-radius: 6px;
  font-family: Inter;
  font-weight: 400;
  font-size: 14px;
  line-height: 1.5em;
  color: #111827;
  box-sizing: border-box;
  outline: none;
  resize: vertical;
}
.contact-form__submit {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 12px 24px;
  width: 100%;
  background-color: #3B82F6;
  border-radius: 8px;
  border: none;
  cursor: pointer;
  font-family: Inter;
  font-weight: 600;
  font-size: 16px;
  line-height: 1.5em;
  color: #FFFFFF;
  text-align: center;
  box-sizing: border-box;
}
```
