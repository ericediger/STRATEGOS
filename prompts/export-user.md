# Export User Prompt Template

Convert the following strategic analysis document into a professionally formatted {{FORMAT}} file.

## Metadata

- **Project Title:** {{PROJECT_TITLE}}
- **Artifact Type:** {{ARTIFACT_TYPE}}
- **Date:** {{DATE}}
- **Output Path:** {{OUTPUT_PATH}}
- **Logo Path:** {{LOGO_PATH}}

## Document Content

The markdown content is saved to a file. Your script MUST load it at runtime:

```javascript
const content = require("fs").readFileSync("{{CONTENT_PATH}}", "utf-8");
```

**Do NOT embed the document content as a string literal in your script.** Always read it from the file path above.

For reference, here is the content you are formatting (do not copy this into your script — read it from the file):

{{CONTENT}}

## Instructions

Write a complete Node.js script that generates the {{FORMAT}} file at the output path specified above. The script must be self-contained — no external markdown parsing libraries. Load the markdown from the content file path shown above, parse it, and produce a polished, professional document following the brand guide and design principles from your system prompt.

// OUTPUT: {{OUTPUT_PATH}}
