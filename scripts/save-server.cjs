// Tiny local endpoint: receives rendered design-frame HTML from the browser and
// writes it to design-ref/extracted/. Lets us capture the real design markup
// faithfully (no manual retyping). Dev-only helper.
const http = require("http");
const fs = require("fs");
const path = require("path");
const ROOT = path.join(__dirname, "..", "design-ref", "extracted");
fs.mkdirSync(ROOT, { recursive: true });
http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") return res.end();
  if (req.method === "POST") {
    const name = new URL(req.url, "http://x").searchParams.get("name");
    let body = "";
    req.on("data", (d) => (body += d));
    req.on("end", () => {
      fs.writeFileSync(path.join(ROOT, name), body);
      console.log("wrote", name, body.length);
      res.end("ok " + name);
    });
  } else res.end("save-server up");
}).listen(5177, () => console.log("save-server on 5177"));
