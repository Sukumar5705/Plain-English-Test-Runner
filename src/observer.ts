
import type { Page } from '@playwright/test';

type ObservedElement = {
  ref: number;
  role: string;
  name: string;
  type?: string;
  placeholder?: string;
  disabled?: boolean;
  checked?: boolean;
  options?: string[];
};

type Observation = {
  url: string;
  title: string;
  elements: ObservedElement[];
  alerts: string[];
  headings: string[];
  text: string;
};

export async function observe(
  page: Page
): Promise<Observation> {
  // Pass source code as a string so esbuild helpers such as
  // __name are never serialized into the browser context.
  const script = String.raw`
    (() => {
      const selector =
        'a[href],button,input:not([type="hidden"]),' +
        'select,textarea,' +
        '[role="button"],[role="link"],[role="tab"],' +
        '[role="checkbox"],[role="radio"],[role="switch"],' +
        '[role="menuitem"],[onclick]';

      function clean(value) {
        return String(value ?? '')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 80);
      }

      function isVisible(element) {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);

        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.display !== 'none' &&
          style.visibility !== 'hidden'
        );
      }

      function isInViewport(element) {
        const rect = element.getBoundingClientRect();

        return (
          rect.bottom > 0 &&
          rect.right > 0 &&
          rect.top < window.innerHeight &&
          rect.left < window.innerWidth
        );
      }

      function getRole(element) {
        const explicitRole = element.getAttribute('role');

        if (explicitRole) {
          return explicitRole;
        }

        const tag = element.tagName.toLowerCase();

        if (tag === 'a') return 'link';
        if (tag === 'button') return 'button';
        if (tag === 'select') return 'combobox';
        if (tag === 'textarea') return 'textbox';

        if (tag === 'input') {
          const type = (element.type || 'text').toLowerCase();

          if (type === 'checkbox') return 'checkbox';
          if (type === 'radio') return 'radio';

          if (
            ['button', 'submit', 'reset', 'image'].includes(type)
          ) {
            return 'button';
          }

          if (type === 'range') return 'slider';
          if (type === 'number') return 'spinbutton';

          return 'textbox';
        }

        return 'generic';
      }

      function getName(element) {
        const ariaLabel = element.getAttribute('aria-label');

        if (ariaLabel) {
          return clean(ariaLabel);
        }

        const labelledBy = element.getAttribute('aria-labelledby');

        if (labelledBy) {
          const labelText = labelledBy
            .split(/\s+/)
            .map((id) => {
              const label = document.getElementById(id);
              return label ? label.innerText : '';
            })
            .join(' ');

          if (labelText.trim()) {
            return clean(labelText);
          }
        }

        const labels = Array.from(element.labels || [])
          .map((label) => label.innerText || '')
          .join(' ');

        if (labels.trim()) {
          return clean(labels);
        }

        const placeholder = element.getAttribute('placeholder');

        if (placeholder) {
          return clean(placeholder);
        }

        // Only read the value of button-like inputs.
        // Never read text, email or password input values.
        const type = (element.type || '').toLowerCase();

        if (
          ['button', 'submit', 'reset', 'image'].includes(type) &&
          element.value
        ) {
          return clean(element.value);
        }

        const innerText = element.innerText || '';

        if (innerText.trim()) {
          return clean(innerText);
        }

        const title = element.getAttribute('title');

        if (title) {
          return clean(title);
        }

        const alt =
          element.getAttribute('alt') ||
          element.querySelector('img[alt]')?.getAttribute('alt');

        if (alt) {
          return clean(alt);
        }

        return clean(element.getAttribute('name') || '');
      }

      // Remove old references before creating new ones.
      document
        .querySelectorAll('[data-tr-ref]')
        .forEach((element) => {
          element.removeAttribute('data-tr-ref');
        });

      const candidates = Array
        .from(document.querySelectorAll(selector))
        .filter(isVisible);

      // Prefer elements currently inside the viewport.
      candidates.sort((a, b) => {
        return (
          Number(isInViewport(b)) -
          Number(isInViewport(a))
        );
      });

      const elements = candidates
        .slice(0, 80)
        .map((element, index) => {
          const ref = index + 1;
          const type = element.type || undefined;
          const placeholder =
            element.getAttribute('placeholder') || undefined;

          element.setAttribute('data-tr-ref', String(ref));

          const item = {
            ref,
            role: getRole(element),
            name: getName(element),
            type,
            placeholder,
            disabled: (
              element.hasAttribute('disabled') ||
              element.getAttribute('aria-disabled') === 'true'
            ) || undefined
          };

          // Report the checked state of checkbox and radio inputs.
          if (
            element.tagName.toLowerCase() === 'input' &&
            ['checkbox', 'radio'].includes(
              (element.type || '').toLowerCase()
            )
          ) {
            item.checked = Boolean(element.checked);
          }

          // Give the model available options for dropdowns.
          if (element.tagName.toLowerCase() === 'select') {
            item.options = Array
              .from(element.options)
              .slice(0, 15)
              .map((option) => clean(option.label || option.textContent));
          }

          return item;
        });

      function visibleText(element) {
        if (!isVisible(element)) {
          return '';
        }

        return clean(element.innerText || element.textContent);
      }

      const alerts = Array.from(
        document.querySelectorAll(
          '[role="alert"],[aria-live],dialog[open],[role="dialog"]'
        )
      )
        .filter(isVisible)
        .map(visibleText)
        .filter(Boolean);

      const headings = Array.from(
        document.querySelectorAll('h1,h2,h3')
      )
        .filter(isVisible)
        .slice(0, 8)
        .map(visibleText)
        .filter(Boolean);

      return {
        url: window.location.href,
        title: document.title,
        elements,
        alerts: Array.from(new Set(alerts)),
        headings,
        text: document.body
          ? document.body.innerText
              .replace(/\s+/g, ' ')
              .slice(0, 1500)
          : ''
      };
    })()
  `;

  return page.evaluate<Observation>(script);
}
