```javascript
import { chromium } from 'playwright';

/**
 * Perform browser automation actions on a given URL.
 * @param {string} url - The URL to navigate to.
 * @param {Array} actions - List of action objects: {type, selector, value, code}.
 *                          Supported types: click, type, screenshot, evaluate.
 * @returns {Object} Result object with overall success, navigation error, and per-action results.
 */
export default async function runTool(url, actions) {
  // --- Input Validation ---
  if (typeof url !== 'string' || url.trim() === '') {
    throw new Error('A valid URL string is required');
  }
  if (!Array.isArray(actions)) {
    throw new Error('Actions must be an array');
  }

  // --- Launch Browser ---
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  // Set default timeout for all page operations (navigation, clicks, etc.)
  const DEFAULT_TIMEOUT = 30000;
  page.setDefaultTimeout(DEFAULT_TIMEOUT);

  const results = [];
  let navigationError = null;

  try {
    // --- Navigation ---
    await page.goto(url, { waitUntil: 'networkidle', timeout: DEFAULT_TIMEOUT });
  } catch (err) {
    navigationError = err.message;
  }

  // --- Process each action (even if navigation failed) ---
  for (const action of actions) {
    const { type, selector, value, code } = action;
    const actionResult = {
      type,
      selector: selector || null,
      value: value || null,
      code: code || null,
      success: false,
      data: null,
      error: null,
    };

    // Skip action execution if navigation failed
    if (navigationError) {
      actionResult.error = 'Navigation failed, action skipped';
      results.push(actionResult);
      continue;
    }

    try {
      switch (type) {
        case 'click': {
          if (!selector) throw new Error('Selector is required for click');
          await page.click(selector);
          actionResult.success = true;
          actionResult.data = `Clicked on "${selector}"`;
          break;
        }

        case 'type': {
          if (!selector) throw new Error('Selector is required for type');
          if (value === undefined || value === null) throw new Error('Value is required for type');
          await page.fill(selector, String(value));
          actionResult.success = true;
          actionResult.data = `Typed "${value}" into "${selector}"`;
          break;
        }

        case 'screenshot': {
          const buffer = await page.screenshot({ fullPage: true });
          actionResult.data = buffer.toString('base64');
          actionResult.success = true;
          break;
        }

        case 'evaluate': {
          if (typeof code !== 'string' || code.trim() === '') {
            throw new Error('Valid JavaScript code string is required for evaluate');
          }
          const evalResult = await page.evaluate(code);
          // Ensure serializable result (basic handling for common cases)
          actionResult.data =
            evalResult !== undefined && evalResult !== null
              ? typeof evalResult === 'object'
                ? JSON.parse(JSON.stringify(evalResult))
                : evalResult
              : null;
          actionResult.success = true;
          break;
        }

        default: {
          throw new Error(`Unsupported action type: "${type}"`);
        }
      }
    } catch (err) {
      actionResult.success = false;
      actionResult.error = err.message;
    }

    results.push(actionResult);
  }

  // --- Cleanup ---
  await browser.close();

  // --- Build final response ---
  const overallSuccess = !navigationError && results.every((r) => r.success);
  return {
    success: overallSuccess,
    navigationError: navigationError,
    results: results,
  };
}
```