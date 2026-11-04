"use strict";
(function () {
  const root = document.documentElement;
  const read = () => { try { return localStorage.getItem("theme"); } catch (e) { return null; } };
  const write = value => { try { localStorage.setItem("theme", value); } catch (e) {} };

  let theme = read() === "dark" ? "dark" : "light";

  const apply = () => {
    root.classList.remove("light", "dark");
    root.classList.add(theme);
  };
  const label = () => {
    const next = theme === "dark" ? "light" : "dark";
    for (const button of document.querySelectorAll(".theme-toggle")) {
      button.setAttribute("aria-label", `Switch to ${next} mode`);
      button.setAttribute("title", `Switch to ${next} mode`);
    }
  };
  apply();

  document.addEventListener("click", event => {
    if (!event.target.closest || !event.target.closest(".theme-toggle")) return;
    theme = theme === "dark" ? "light" : "dark";
    write(theme);
    apply();
    label();
  });

  const ready = () => {
    for (const button of document.querySelectorAll(".theme-toggle")) button.removeAttribute("onclick");
    label();
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
})();