import FigmaTokenParser from "./generateTokens.mjs";

// Egyszerű használat
async function main() {
  // Token forrás: GitHub repo vagy lokális fájl
  const tokenSource =
    process.argv.slice(2)[0] ||
    process.env.TOKENS_SOURCE ||
    "https://github.com/brenca/ablements-design-tokens";
  const parser = new FigmaTokenParser(tokenSource, "./css");

  try {
    console.info("🚀 Token parser indítása...");
    console.info("📍 Forrás:", tokenSource);

    await parser.loadTokens();
    await parser.generateSCSS();

    console.info("✅ Token generation is complete!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Hiba:", error.message);
    process.exit(1);
  }
}

main();
