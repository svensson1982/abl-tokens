import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import simpleGit from "simple-git";
import fsExtra from "fs-extra";

const __filename = fileURLToPath(import.meta.url);

export default class FigmaTokenParser {
  constructor(tokenSource, outputDir = "./css") {
    this.tokenSource = tokenSource;
    this.outputDir = outputDir;
    this.tokens = {};
    this.tempRepoDir = "./temp-tokens-repo";
  }

  async loadTokens() {
    try {
      console.info("📦 Cloning GitHub repo:", this.tokenSource);
      const tokenPath = await this.cloneAndExtractTokens();

      const data = fs.readFileSync(tokenPath, "utf8");
      this.tokens = JSON.parse(data);
      console.info("✅ Tokens loaded:", tokenPath);

      await this.cleanup();
    } catch (error) {
      console.error("❌ Error loading tokens:", error.message);
      await this.cleanup();
      throw error;
    }
  }

  async cloneAndExtractTokens() {
    if (!fs.existsSync(this.tempRepoDir)) {
      fs.mkdirSync(this.tempRepoDir, { recursive: true });
    }

    const git = simpleGit(this.tempRepoDir);

    try {
      if (fs.existsSync(path.join(this.tempRepoDir, ".git"))) {
        console.info("🧹 Removing existing repo...");
        await fsExtra.remove(this.tempRepoDir);
        fs.mkdirSync(this.tempRepoDir, { recursive: true });
      }

      console.info("⬇️ Cloning repo...");
      await git.clone(this.tokenSource, ".");

      const tokenPath = path.join(this.tempRepoDir, "tokens.json");

      if (!fs.existsSync(tokenPath)) {
        throw new Error(`tokens.json not found in repo: ${this.tokenSource}`);
      }

      return tokenPath;
    } catch (error) {
      throw new Error(`GitHub repo clone error: ${error.message}`);
    }
  }

  async cleanup() {
    if (fs.existsSync(this.tempRepoDir)) {
      try {
        await fsExtra.remove(this.tempRepoDir);
        console.info("🧹 Temp files removed");
      } catch (error) {
        console.warn("⚠️ Temp file cleanup error:", error.message);
      }
    }
  }

  // Enhanced generateBaseFile method to handle themes
  generateBaseFile(categories) {
    const baseDir = path.join(this.outputDir, "base");
    if (!fs.existsSync(baseDir)) {
      fs.mkdirSync(baseDir, { recursive: true });
    }

    // Separate theme and non-theme tokens
    const themeTokens = {
      light: {},
      dark: {},
    };
    const baseTokens = {};

    for (const [categoryName, { variables }] of Object.entries(categories)) {
      const lowerCategoryName = categoryName.toLowerCase();

      if (lowerCategoryName.includes("light")) {
        themeTokens.light[categoryName] = { variables };
      } else if (lowerCategoryName.includes("dark")) {
        themeTokens.dark[categoryName] = { variables };
      } else {
        baseTokens[categoryName] = { variables };
      }
    }

    // Generate base variables file (non-theme specific)
    this.generateVariablesFile(baseDir, baseTokens);

    // Generate theme-specific files
    if (Object.keys(themeTokens.light).length > 0) {
      this.generateThemeFile(baseDir, "light", themeTokens.light);
    }

    if (Object.keys(themeTokens.dark).length > 0) {
      this.generateThemeFile(baseDir, "dark", themeTokens.dark);
    }
  }

  generateVariablesFile(baseDir, categories) {
    let content = `// Design Tokens - Base CSS Variables
// Automatically generated from Figma tokens
// Theme-independent tokens

:root {
`;

    for (const [categoryName, { variables }] of Object.entries(categories)) {
      if (variables.length > 0) {
        const categoryTitle =
          categoryName.charAt(0).toUpperCase() + categoryName.slice(1);
        content += `\n  // ${categoryTitle} tokens\n`;

        variables.forEach((variable) => {
          content += `  ${variable}\n`;
        });
      }
    }

    content += `}\n`;
    content = this.globalFixReferences(content);

    fs.writeFileSync(path.join(baseDir, "_variables.scss"), content);
  }

  generateThemeFile(baseDir, themeName, categories) {
    let content = `// Design Tokens - ${
      themeName.charAt(0).toUpperCase() + themeName.slice(1)
    } Theme
// Automatically generated from Figma tokens

@import 'variables';

`;

    // Wrap in appropriate selector
    if (themeName === "light") {
      content += `:root {
`;
    } else {
      content += `.${themeName} {
`;
    }

    for (const [categoryName, { variables }] of Object.entries(categories)) {
      if (variables.length > 0) {
        const categoryTitle =
          categoryName
            .replace(/light|dark/gi, "")
            .trim()
            .charAt(0)
            .toUpperCase() +
          categoryName
            .replace(/light|dark/gi, "")
            .trim()
            .slice(1);

        content += `\n  // ${categoryTitle} tokens\n`;

        variables.forEach((variable) => {
          // Remove theme prefix from variable names for cleaner usage
          const cleanedVariable = variable.replace(/(-light|-dark)(?=:)/, "");
          content += `  ${cleanedVariable}\n`;
        });
      }
    }

    content += `}\n`;
    content = this.globalFixReferences(content);

    fs.writeFileSync(path.join(baseDir, `_${themeName}.scss`), content);
  }

  // Updated flattenTokens to preserve theme information
  flattenTokens(obj, baseName, categories, prefix = "") {
    for (const [key, value] of Object.entries(obj)) {
      if (!key || key.startsWith("$")) continue;

      const normalizedKey = this.normalizeTokenName(key);
      const currentPath = prefix ? `${prefix}-${normalizedKey}` : normalizedKey;

      if (value && typeof value === "object" && (value.$type || value.type)) {
        // Preserve theme information in category key
        const categoryKey = baseName.replace(/[\\\/]/g, "-").toLowerCase();
        if (!categories[categoryKey]) {
          categories[categoryKey] = { variables: [], mixins: [] };
        }

        const tokenName = currentPath;
        const tokenType = value.$type || value.type;
        const tokenValue = value.$value || value.value;

        if (tokenValue === undefined || tokenValue === null) continue;

        let converted = this.convertValue(tokenValue, tokenType);

        if (typeof converted === "string" && !converted.includes("var(--")) {
          converted = this.processStringReferences(converted, tokenType);
        }

        if (tokenType === "typography" && typeof converted === "object") {
          let mixinContent = `@mixin ${tokenName} {\n`;
          for (const [prop, val] of Object.entries(converted)) {
            mixinContent += `  ${prop}: ${val};\n`;
          }
          mixinContent += `}`;
          categories[categoryKey].mixins.push(mixinContent);

          for (const [prop, val] of Object.entries(converted)) {
            categories[categoryKey].variables.push(
              `--${tokenName}-${prop.replace("font-", "")}: ${val};`
            );
          }
        } else {
          const variableLine = `--${tokenName}: ${converted};`;
          categories[categoryKey].variables.push(variableLine);
        }
      } else if (value && typeof value === "object" && !Array.isArray(value)) {
        this.flattenTokens(value, baseName, categories, currentPath);
      }
    }
  }

  // Rest of the methods remain the same...
  convertValue(value, type = null) {
    if (typeof value === "object" && value !== null) {
      if (value.value !== undefined) {
        return this.convertValue(value.value, value.type);
      }

      if (type === "boxShadow" || this.isBoxShadow(value)) {
        if (Array.isArray(value)) {
          return value
            .map((shadow) => this.convertShadowObject(shadow))
            .join(", ");
        } else {
          return this.convertShadowObject(value);
        }
      }

      if (type === "border") {
        const { width = 1, style = "solid", color = "#000" } = value;
        return `${width}px ${style} ${color}`;
      }

      if (type === "typography") {
        return {
          "font-family": value.fontFamily || "inherit",
          "font-size": value.fontSize ? `${value.fontSize}px` : "inherit",
          "font-weight": value.fontWeight || "inherit",
          "line-height": value.lineHeight || "inherit",
          "letter-spacing": value.letterSpacing
            ? `${value.letterSpacing}px`
            : "normal",
        };
      }

      return JSON.stringify(value);
    }

    if (typeof value === "number") {
      if (
        type === "dimension" ||
        type === "spacing" ||
        type === "borderRadius"
      ) {
        return `${value}px`;
      }
      return value;
    }

    if (typeof value === "string") {
      if (value.includes("var(--")) {
        return value;
      }
      return this.processStringReferences(value, type);
    }

    return value;
  }

  processStringReferences(str, type = null) {
    const withReferences = str.replace(/\{([^}]+)\}/g, (match, refPath) => {
      const normalizedRef = this.normalizeReferencePath(refPath.trim());
      return `var(--${normalizedRef})`;
    });

    if (this.needsCalc(withReferences, type)) {
      return `calc(${withReferences})`;
    }

    return withReferences;
  }

  needsCalc(str, type) {
    const hasMath = /[\+\-\*\/]/.test(str);
    const hasVar = str.includes("var(--");

    if (hasMath && hasVar) {
      if (!str.startsWith("calc(")) {
        return true;
      }
    }

    return false;
  }

  globalFixReferences(content) {
    const lines = content.split("\n");
    const processedLines = lines.map((line) => {
      if (
        line.trim().startsWith("--") ||
        line.trim().startsWith("//") ||
        line.trim() === ""
      ) {
        return line;
      }
      return line.replace(/\{([^}]+)\}/g, (match, refPath) => {
        const normalizedRef = this.normalizeReferencePath(refPath.trim());
        return `var(--${normalizedRef})`;
      });
    });
    return processedLines.join("\n");
  }

  normalizeReferencePath(refPath) {
    return refPath
      .split(".")
      .map((part) => this.normalizeTokenName(part))
      .join("-");
  }

  normalizeTokenName(name) {
    return name
      .replace(/([a-z])([A-Z])/g, "$1-$2")
      .replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
      .replace(/^-+|-+$/g, "")
      .toLowerCase();
  }

  isBoxShadow(obj) {
    return (
      obj &&
      ((obj.x !== undefined && obj.y !== undefined) ||
        obj.type === "dropShadow" ||
        obj.type === "innerShadow")
    );
  }

  convertShadowObject(shadow) {
    const x = shadow.x || 0;
    const y = shadow.y || 0;
    const blur = shadow.blur || 0;
    const spread = shadow.spread || 0;
    const color = shadow.color || "#000";
    const type = shadow.type || "dropShadow";

    const inset = type === "innerShadow" ? "inset " : "";
    return `${inset}${x}px ${y}px ${blur}px ${spread}px ${color}`;
  }

  async generateSCSS() {
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    const categories = {};

    for (const [categoryName, categoryTokens] of Object.entries(this.tokens)) {
      if (categoryName.startsWith("$") || categoryName.startsWith("_"))
        continue;
      this.flattenTokens(categoryTokens, categoryName, categories);
    }

    this.generateBaseFile(categories);

    for (const [categoryName, { variables, mixins }] of Object.entries(
      categories
    )) {
      this.generateCategoryFile(categoryName, variables, mixins);
    }

    this.generateIndexFile(Object.keys(categories));

    console.info("✅ SCSS files successfully generated:", this.outputDir);
  }

  generateCategoryFile(categoryName, variables, mixins) {
    const componentDir = path.join(this.outputDir, "components");
    if (!fs.existsSync(componentDir)) {
      fs.mkdirSync(componentDir, { recursive: true });
    }

    const safeCategoryName = categoryName.replace(/[\\\/]/g, "-").toLowerCase();
    const filePath = path.join(componentDir, `_${safeCategoryName}.scss`);

    const fileDir = path.dirname(filePath);
    if (!fs.existsSync(fileDir)) {
      fs.mkdirSync(fileDir, { recursive: true });
    }

    let content = `// ${
      categoryName.charAt(0).toUpperCase() + categoryName.slice(1)
    } Tokens
// Automatically generated from Figma tokens

@import '../base/variables';

`;

    // Import only the relevant theme file
    const lowerCategoryName = categoryName.toLowerCase();
    if (lowerCategoryName.includes("light")) {
      content += `@import '../base/light';\n\n`;
    } else if (lowerCategoryName.includes("dark")) {
      content += `@import '../base/dark';\n\n`;
    }

    if (mixins.length > 0) {
      content += `// Mixins\n`;
      mixins.forEach((mixin) => {
        content += `${mixin}\n\n`;
      });
    }

    content += `// Utility Classes\n`;
    content += this.generateBasicUtilities(categoryName, variables, mixins);

    fs.writeFileSync(filePath, content);
  }

  generateBasicUtilities(categoryName, variables, mixins) {
    let utilities = "";

    mixins.forEach((mixin) => {
      const match = mixin.match(/@mixin ([^{]+)/);
      if (match) {
        const mixinName = match[1].trim();
        utilities += `.${mixinName} { @include ${mixinName}; }\n`;
      }
    });

    if (categoryName.includes("color") || this.hasColorTokens(variables)) {
      utilities += this.generateColorUtilities(variables);
    }

    if (categoryName.includes("spacing") || this.hasSpacingTokens(variables)) {
      utilities += this.generateSpacingUtilities(variables);
    }

    if (this.isComponentTokens(variables)) {
      utilities += this.generateComponentUtilities(categoryName, variables);
    }

    return utilities || `// No utilities generated for ${categoryName}\n`;
  }

  hasColorTokens(variables) {
    return variables.some(
      (variable) =>
        variable.includes("color") ||
        variable.includes("background") ||
        variable.match(/--[^:]*-\d+:/)
    );
  }

  hasSpacingTokens(variables) {
    return variables.some(
      (variable) =>
        variable.includes("spacing") ||
        variable.includes("padding") ||
        variable.includes("margin") ||
        variable.includes("gap")
    );
  }

  isComponentTokens(variables) {
    const componentPatterns = [
      "background",
      "border",
      "hover",
      "active",
      "focus",
      "disabled",
      "checked",
      "selected",
    ];
    return variables.some((variable) =>
      componentPatterns.some((pattern) => variable.includes(pattern))
    );
  }

  generateColorUtilities(variables) {
    let styles = "";
    variables.forEach((variable) => {
      const match = variable.match(/--([^:]+):/);
      if (match) {
        const className = match[1];
        if (
          className.includes("color") ||
          className.includes("background") ||
          className.match(/\d+$/)
        ) {
          styles += `.text-${className} { color: var(--${className}); }\n`;
          styles += `.bg-${className} { background-color: var(--${className}); }\n`;
          styles += `.border-${className} { border-color: var(--${className}); }\n`;
        }
      }
    });
    return styles;
  }

  generateSpacingUtilities(variables) {
    let styles = "";
    variables.forEach((variable) => {
      const match = variable.match(/--([^:]+):/);
      if (match) {
        const className = match[1];
        if (
          className.includes("spacing") ||
          className.includes("padding") ||
          className.includes("margin")
        ) {
          styles += `.m-${className} { margin: var(--${className}); }\n`;
          styles += `.p-${className} { padding: var(--${className}); }\n`;
        }
      }
    });
    return styles;
  }

  generateComponentUtilities(categoryName, categoryData) {
    let styles = `// ${categoryName} component utilities\n`;

    styles += `.${categoryName} {\n`;
    styles += `  // Base styles using tokens\n`;

    const baseVars = categoryData.base || [];
    baseVars.forEach((variable) => {
      const match = variable.match(/--([^:]+):/);
      if (match) {
        const tokenName = match[1];
        const property = this.mapTokenToProperty(tokenName);
        if (property) {
          styles += `  ${property}: var(--${tokenName});\n`;
        }
      }
    });

    styles += `}\n\n`;

    const states = [
      "hover",
      "active",
      "focus",
      "disabled",
      "checked",
      "selected",
    ];
    states.forEach((state) => {
      const stateVars = categoryData[state] || [];
      if (stateVars.length === 0) return;

      styles += `.${categoryName}:${state} {\n`;
      stateVars.forEach((variable) => {
        const match = variable.match(/--([^:]+):/);
        if (match) {
          const tokenName = match[1];
          const baseToken = tokenName.replace(`-${state}`, "");
          const property = this.mapTokenToProperty(baseToken);
          if (property) {
            styles += `  ${property}: var(--${tokenName});\n`;
          }
        }
      });
      styles += `}\n\n`;
    });

    return styles;
  }

  mapTokenToProperty(tokenName) {
    if (tokenName.includes("background")) return "background";
    if (tokenName.includes("color") && !tokenName.includes("background"))
      return "color";
    if (tokenName.includes("border-color")) return "border-color";
    if (tokenName.includes("border-radius")) return "border-radius";
    if (tokenName.includes("padding")) return "padding";
    if (tokenName.includes("margin")) return "margin";
    if (tokenName.includes("font-size")) return "font-size";
    if (tokenName.includes("font-weight")) return "font-weight";
    if (tokenName.includes("line-height")) return "line-height";
    return null;
  }

  // Updated generateIndexFile to include theme files
  generateIndexFile(categories) {
    let content = `// Design Tokens - Main Index
// Automatically generated from Figma tokens

// Base files
@import 'base/variables';
@import 'base/light';
@import 'base/dark';

// Component files
`;

    categories.forEach((category) => {
      const safeCategoryName = category.replace(/[\\\/]/g, "-").toLowerCase();
      content += `@import 'components/${safeCategoryName}';\n`;
    });

    // Add theme switching helper comment
    content += `
// Theme Usage:
// Add class="dark" to your <html> or <body> element for dark theme
// Light theme is the default (applies to :root)
// Example: <body class="dark">
// 
// For Tailwind CSS compatibility:
// This works seamlessly with Tailwind's dark mode class strategy
`;

    fs.writeFileSync(path.join(this.outputDir, "index.scss"), content);
  }
}
