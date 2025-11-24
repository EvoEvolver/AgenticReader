import {existsSync} from 'fs';
import {basename, extname, resolve} from 'path';
import {uploadFileToMinio} from './minioClient';
//import {mineruPipeline} from './mineruPipeline';
import dotenv from 'dotenv';
import {myPdfPipeline} from "./myPdfPipeline";

// Load environment variables
dotenv.config();

export interface ConvertOptions {
    outputPath?: string;
    bucket?: string;
    upload?: boolean;
}

export async function convertPdfToHtml(
    pdfPath: string,
    options: ConvertOptions = {}
): Promise<string> {
    const {bucket = 'pdf', upload = true} = options;

    // Validate environment variables
    if (!process.env.MINERU_TOKEN) {
        throw new Error('MINERU_TOKEN environment variable is not set');
    }

    // Determine if input is a URL or file path
    let fileUrl: string;


    // Input is a file path - need to upload to MinIO
    const filePath = resolve(pdfPath);

    if (!existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
    }

    // Check if it's a PDF file
    if (extname(filePath).toLowerCase() !== '.pdf') {
        throw new Error('Input file must be a PDF');
    }

    if (!upload) {
        throw new Error('Local file requires upload option to be true');
    }

    // Check MinIO configuration
    if (!process.env.MINIO_ENDPOINT || !process.env.MINIO_ACCESS_KEY || !process.env.MINIO_SECRET_KEY) {
        throw new Error('MinIO configuration is incomplete. Required: MINIO_ENDPOINT, MINIO_ACCESS_KEY, MINIO_SECRET_KEY');
    }

    console.log('\n=== Uploading PDF to MinIO ===\n');
    console.log(`File: ${basename(filePath)}`);
    fileUrl = await uploadFileToMinio(filePath, bucket, true);
    console.log(`Uploaded to: ${fileUrl}\n`);


    // Determine output path
    let outputPath: string;


    // Use input filename
    const inputBasename = pdfPath.replace('.pdf', '');
    outputPath = resolve(`${pdfPath}.html`);


    // Run the MinerU pipeline
    //await mineruPipeline(fileUrl, outputPath);
    await myPdfPipeline(filePath, outputPath);

    console.log('\n✓ Conversion complete!');
    console.log(`Output: ${outputPath}`);

    return outputPath;
}
