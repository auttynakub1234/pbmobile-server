const fs = require("fs");

function analyzeClient() {
  const code = fs.readFileSync("/root/pbmobile_analysis/client.js", "utf8");
  console.log("Client.js length:", code.length);

  const fetchMatches = [...code.matchAll(/fetch\s*\(\s*["']([^"']+)["']/g)].map(m => m[1]);
  console.log("Fetch URLs:", [...new Set(fetchMatches)]);

  // Look for WebSocket actions or message types
  const wsActions = [...code.matchAll(/t\s*:\s*["']([a-zA-Z0-9_]+)["']/g)].map(m => m[1]);
  console.log("Common message action types (first 40):", [...new Set(wsActions)].slice(0, 40));
}

analyzeClient();
