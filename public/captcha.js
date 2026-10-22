"use strict";

// cloudflare turnstile on this server's pages (lib/captcha.js). the server
// writes its site key in below, or "" when it asks for no captcha.
//
// const check = captcha.mount(element, "login") shows the widget in
// `element`, as a page loads; await check.answer() before a request (it
// waits while the player is still solving it; undefined when the server
// asks for none, "" when the captcha could not load or run: say
// captcha.FAILED then), and check.reset() after it: an answer is good once.
window.captcha = (() => {
  const siteKey = "{{siteKey}}";
  let loading = null;

  const load = () => {
    loading = loading || new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.onload = () => resolve(window.turnstile);
      script.onerror = () => {
        loading = null;
        reject(new Error("the captcha did not load"));
      };
      document.head.append(script);
    });
    return loading;
  };

  // `options`: {appearance} ("interaction-only" by default: seen only when
  // cloudflare wants a click), {onAnswer(token)}.
  const mount = (element, action, options = {}) => {
    let widget = null;
    let answer = null; // a token, "" when none could be had, null while waiting
    let waiting = [];
    const settle = value => {
      answer = value;
      if (value && options.onAnswer) {
        options.onAnswer(value);
      }
      for (const resolve of waiting) {
        resolve(value);
      }
      waiting = [];
    };
    if (siteKey) {
      load().then(turnstile => {
        widget = turnstile.render(element, {
          sitekey: siteKey,
          action,
          theme: "dark",
          appearance: options.appearance || "interaction-only",
          callback: settle,
          "expired-callback": () => {
            answer = null;
          },
          // its code is cloudflare's (110200: this site's name is not on the widget)
          "error-callback": code => {
            console.log(`captcha error ${code}`);
            settle("");
          },
        });
      }, () => settle(""));
    }
    return {
      on: Boolean(siteKey),
      answer: () => {
        if (!siteKey) {
          return Promise.resolve(undefined);
        }
        return answer !== null ? Promise.resolve(answer) : new Promise(resolve => waiting.push(resolve));
      },
      // (a widget that never loaded keeps its "" so nothing waits on it)
      reset: () => {
        if (widget !== null) {
          answer = null;
          window.turnstile.reset(widget);
        }
      },
    };
  };

  return {on: Boolean(siteKey), mount, FAILED: "Captcha could not load. Reload the page."};
})();
