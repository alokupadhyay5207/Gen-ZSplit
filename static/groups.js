/* Gen-ZSplit group UI. Progressive enhancement: every form still works without
   this file, and the server re-validates every split. */
(function () {
  "use strict";
  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ---------- dialogs ---------- */
  function openDialog(id) {
    var d = document.getElementById(id);
    if (d && typeof d.showModal === "function" && !d.open) {
      d.showModal();
      var first = $("[autofocus], input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea", d);
      if (first) { try { first.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
    }
    return d;
  }
  document.addEventListener("click", function (e) {
    var opener = e.target.closest("[data-open-modal]");
    if (opener) { e.preventDefault(); openDialog(opener.getAttribute("data-open-modal")); return; }
    var closer = e.target.closest("[data-close-modal]");
    if (closer) { var dlg = closer.closest("dialog"); if (dlg) dlg.close(); return; }
    // click on the backdrop (the dialog element itself) closes it
    if (e.target.tagName === "DIALOG" && e.target.open) {
      var r = e.target.getBoundingClientRect();
      var inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) e.target.close();
    }
  });
  $$("dialog[data-autoopen]").forEach(function (d) { if (typeof d.showModal === "function") d.showModal(); });

  /* ---------- toasts ---------- */
  function dismiss(t) {
    t.classList.add("is-leaving");
    setTimeout(function () { t.remove(); }, 260);
  }
  $$("[data-toast]").forEach(function (t) {
    var ms = t.getAttribute("data-kind") === "error" ? 9000 : 5500;
    var timer = setTimeout(function () { dismiss(t); }, ms);
    t.addEventListener("mouseenter", function () { clearTimeout(timer); });
    var btn = $("[data-dismiss]", t);
    if (btn) btn.addEventListener("click", function () { clearTimeout(timer); dismiss(t); });
  });

  /* ---------- copy invite code ---------- */
  $$("[data-copy]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var text = btn.getAttribute("data-copy");
      var label = $("[data-copy-label]", btn);
      var done = function () {
        if (!label) return;
        var old = label.textContent;
        label.textContent = "Copied";
        setTimeout(function () { label.textContent = old; }, 1800);
      };
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(text).then(done, done);
      } else {
        var ta = document.createElement("textarea");
        ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
        document.body.appendChild(ta); ta.select();
        try { document.execCommand("copy"); } catch (err) { /* ignore */ }
        ta.remove(); done();
      }
    });
  });

  /* ---------- password reveal ---------- */
  $$("[data-toggle-pw]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var input = btn.parentElement.querySelector("input");
      var show = input.type === "password";
      input.type = show ? "text" : "password";
      btn.setAttribute("aria-label", show ? "Hide password" : "Show password");
      btn.setAttribute("aria-pressed", show ? "true" : "false");
      var use = $("use", btn);
      if (use) use.setAttribute("href", show ? "#i-eye-off" : "#i-eye");
    });
  });

  /* ---------- shared confirm dialog ---------- */
  var confirmDlg = document.getElementById("confirm-modal");
  if (confirmDlg) {
    document.addEventListener("click", function (e) {
      var t = e.target.closest("[data-confirm]");
      if (!t) return;
      e.preventDefault();
      $("[data-confirm-form]", confirmDlg).setAttribute("action", t.getAttribute("data-action"));
      $("[data-confirm-title]", confirmDlg).textContent = t.getAttribute("data-title") || "Are you sure?";
      $("[data-confirm-body]", confirmDlg).textContent = t.getAttribute("data-body") || "";
      $("[data-confirm-button]", confirmDlg).textContent = t.getAttribute("data-button") || "Confirm";
      openDialog("confirm-modal");
    });
  }

  /* ---------- double-submit guard (a duplicate POST would be a duplicate expense) ---------- */
  document.addEventListener("submit", function (e) {
    var form = e.target;
    if (!form.hasAttribute || !form.hasAttribute("data-once")) return;
    if (form.dataset.submitted === "1") { e.preventDefault(); return; }
    form.dataset.submitted = "1";
    $$("button[type=submit]", form).forEach(function (b) { b.classList.add("is-busy"); b.setAttribute("aria-busy", "true"); });
  });
  // bfcache: coming back via Back must not leave a permanently disabled form
  window.addEventListener("pageshow", function (e) {
    if (!e.persisted) return;
    $$("form[data-once]").forEach(function (f) {
      delete f.dataset.submitted;
      $$("button.is-busy", f).forEach(function (b) { b.classList.remove("is-busy"); b.removeAttribute("aria-busy"); });
    });
  });

  /* ---------- expense split calculator ---------- */
  var form = document.getElementById("expense-form");
  if (!form) return;
  var exp = parseInt(form.getAttribute("data-exp"), 10) || 0;
  var symbol = form.getAttribute("data-symbol") || "";
  var locale = form.getAttribute("data-currency") === "INR" ? "en-IN" : "en-US";
  var amountInput = $("[name=amount]", form);
  var summary = $("[data-split-summary]", form);
  var rows = $$("[data-person]", form);
  var scale = Math.pow(10, exp);

  function toMinor(v) {
    v = String(v || "").replace(/,/g, "").trim();
    if (!/^\d+(\.\d+)?$/.test(v)) return null;
    return Math.round(parseFloat(v) * scale);
  }
  function fmt(minor) {
    var n = minor / scale;
    return symbol + n.toLocaleString(locale, { minimumFractionDigits: exp, maximumFractionDigits: exp });
  }
  function method() { var r = $("[name=split_method]:checked", form); return r ? r.value : "equal"; }

  function refresh() {
    var m = method();
    form.setAttribute("data-method", m);
    var picked = rows.filter(function (r) { return $("[type=checkbox]", r).checked; });
    rows.forEach(function (r) {
      var checked = $("[type=checkbox]", r).checked;
      $$(".gz-person-value input", r).forEach(function (i) {
        var mine = (m === "exact" && i.name.indexOf("exact_") === 0) || (m === "percentage" && i.name.indexOf("percent_") === 0);
        i.disabled = !(checked && mine);
      });
    });
    var total = toMinor(amountInput.value);
    var cls = "gz-summary", text = "";
    if (m === "equal") {
      if (!picked.length) { cls += " is-bad"; text = "Pick at least one person."; }
      else if (total) {
        var base = Math.floor(total / picked.length);
        var rem = total - base * picked.length;
        text = fmt(base) + " each" + (rem ? " (plus " + rem + " smallest unit" + (rem > 1 ? "s" : "") + " shared out)" : "");
        cls += " is-ok";
      } else { text = "Enter an amount to see each share."; }
    } else if (m === "exact") {
      var sum = 0, bad = false;
      picked.forEach(function (r) {
        var v = toMinor($("input[name^=exact_]", r).value);
        if (v === null) bad = true; else sum += v;
      });
      if (!total) text = "Enter the total amount first.";
      else if (bad) { cls += " is-bad"; text = "Fill in an amount for everyone selected (0 is fine)."; }
      else if (sum === total) { cls += " is-ok"; text = "Adds up to " + fmt(total) + "."; }
      else { cls += " is-bad"; text = fmt(Math.abs(total - sum)) + (sum < total ? " still to assign." : " over the total."); }
    } else {
      var pct = 0, pbad = false;
      picked.forEach(function (r) {
        var raw = $("input[name^=percent_]", r).value.trim();
        if (!/^\d+(\.\d{1,2})?$/.test(raw)) pbad = true; else pct += Math.round(parseFloat(raw) * 100);
      });
      if (pbad) { cls += " is-bad"; text = "Fill in a percentage for everyone selected."; }
      else if (pct === 10000) { cls += " is-ok"; text = "Adds up to 100%."; }
      else { cls += " is-bad"; text = (pct / 100) + "% assigned. Needs to be exactly 100%."; }
    }
    summary.className = cls;
    summary.textContent = text;
  }

  form.addEventListener("input", refresh);
  form.addEventListener("change", refresh);
  $$("[data-select]", form).forEach(function (b) {
    b.addEventListener("click", function () {
      var on = b.getAttribute("data-select") === "all";
      rows.forEach(function (r) { $("[type=checkbox]", r).checked = on; });
      refresh();
    });
  });
  refresh();
})();
