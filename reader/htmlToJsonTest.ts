import {readFileSync} from "fs";
import dotenv from "dotenv";
import {htmlToMarkdownChunksWithSummaries} from "./htmlToMarkdownTree";
dotenv.config();

async function test(htmlPath){
    console.log('Step 2: Reading HTML...');
    const htmlContent = readFileSync(htmlPath, 'utf-8');

    console.log('Step 3: Building tree structure...');
    const chunkWithSummaryJson = await htmlToMarkdownChunksWithSummaries(htmlContent);

    console.log('Step 4: Converting to JSON...');
    const jsonOutput = JSON.stringify(chunkWithSummaryJson, null, 2);
    const outputJsonPath = htmlPath + ".json";
    if (outputJsonPath) {
        const { writeFileSync } = await import('fs');
        writeFileSync(outputJsonPath, jsonOutput, 'utf-8');
        console.log(`JSON saved to: ${outputJsonPath}`);
    }
}

test("/Users/zijian/WebstormProjects/AgenticReader/reader/10.1021:acsmaterialslett.9b00536.html")