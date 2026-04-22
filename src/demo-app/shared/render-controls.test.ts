import { strict as assert } from "node:assert";
import test from "node:test";
import { renderButton, renderTextInput } from "./render-controls";

test("renderButton preserves the app-backed submit button contract", () => {
  assert.equal(
    renderButton({
      label: "Run intent",
      className: "primary-button",
      id: "submit-button",
      type: "submit",
      attributes: {
        "data-testid": "run-tests-button"
      }
    }),
    '<button class="primary-button" id="submit-button" type="submit" data-testid="run-tests-button">Run intent</button>'
  );
});

test("renderTextInput supports both Studio inputs and library input fields", () => {
  assert.equal(
    renderTextInput({
      id: "source-editor-display-name",
      placeholder: "Current app"
    }),
    '<input id="source-editor-display-name" type="text" placeholder="Current app" />'
  );

  assert.equal(
    renderTextInput({
      className: "input-field",
      value: "Search users"
    }),
    '<input class="input-field" type="text" value="Search users" />'
  );
});