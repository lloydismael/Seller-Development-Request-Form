(function () {
  function mount(container, share) {
    container.replaceChildren();
    if (!share?.link) return;
    const url = new URL(share.link, location.origin).href;
    const label = document.createElement("label"); label.textContent = "Session CSAT link";
    const input = document.createElement("input"); input.value = url; input.readOnly = true; label.append(input);
    const copy = document.createElement("button"); copy.type = "button"; copy.className = "btn"; copy.textContent = "Copy link";
    const status = document.createElement("p"); status.setAttribute("role", "status");
    copy.onclick = async () => { input.select(); try { await navigator.clipboard.writeText(url); status.textContent = "Link copied."; } catch { status.textContent = "Select and copy the link manually."; } };
    container.append(label, copy, status);
    try {
      if (typeof window.qrcode !== "function") throw new Error("QR generator unavailable.");
      const qr = window.qrcode(0, "M"); qr.addData(url); qr.make();
      const count = qr.getModuleCount(), cell = 6, quiet = 4;
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = (count + quiet * 2) * cell;
      canvas.className = "csat-qr"; canvas.setAttribute("role", "img"); canvas.setAttribute("aria-label", "Scan this QR code to open the session CSAT survey");
      const ctx = canvas.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.fillStyle = "#000";
      for (let r = 0; r < count; r++) for (let c = 0; c < count; c++) if (qr.isDark(r, c)) ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell);
      const download = document.createElement("button"); download.type = "button"; download.className = "btn"; download.textContent = "Download QR";
      download.onclick = () => { const a = document.createElement("a"); a.download = "csat-session-qr.png"; a.href = canvas.toDataURL("image/png"); a.click(); };
      container.append(canvas, download);
      if (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) {
        const warning = document.createElement("p"); warning.textContent = "This localhost QR works only on this computer. Phone scanning needs a reachable development URL or deployed site."; container.append(warning);
      }
    } catch { status.textContent = "QR unavailable. The link can still be copied."; }
  }
  window.CsatShare = { mount };
})();
