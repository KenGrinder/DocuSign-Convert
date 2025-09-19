/**
 * Client-side DocuSign JSON to PDF converter
 * This module handles the conversion of DocuSign template JSON files to fillable PDFs
 * using the PDF-lib library for client-side processing.
 */

// Constants for PDF conversion
const DEFAULT_FONT_NAME = 'Helvetica';
const DEFAULT_TEXT_FIELD_WIDTH = 120;
const DEFAULT_TEXT_FIELD_HEIGHT = 20;
const DEFAULT_HEADER_MASK_HEIGHT = 24.0;
const DEFAULT_FONT_SIZE = 12;
const DEFAULT_BORDER_STYLE = 'underlined';

/**
 * Main conversion function that takes DocuSign JSON data and converts it to a PDF
 * @param {Object} templateData - The parsed DocuSign template JSON
 * @param {Object} options - Conversion options
 * @returns {Promise<Uint8Array>} - The converted PDF as bytes
 */
async function convertDocuSignToPDF(templateData, options = {}) {
    try {
        // Extract documents from the template
        const documents = templateData.documents || [];
        if (documents.length === 0) {
            throw new Error('No documents found in template JSON');
        }

        // Decode and process each document
        const pdfDocs = [];
        for (const doc of documents) {
            const docId = doc.documentId;
            const base64Data = doc.documentBase64 || doc.documentBase64Bytes;
            
            if (!base64Data) {
                console.warn(`No base64 data found for document ${docId}`);
                continue;
            }

            try {
                const pdfBytes = base64ToUint8Array(base64Data);
                const pdfDoc = await PDFLib.PDFDocument.load(pdfBytes);
                pdfDocs.push({ docId, pdfDoc });
            } catch (error) {
                console.warn(`Failed to load document ${docId}:`, error);
            }
        }

        if (pdfDocs.length === 0) {
            throw new Error('No valid PDF documents found in template');
        }

        // Create a new PDF document to merge all pages
        const mergedPdf = await PDFLib.PDFDocument.create();
        const pageMapping = []; // Track which pages belong to which document

        // Merge all pages from all documents
        for (const { docId, pdfDoc } of pdfDocs) {
            const startPage = mergedPdf.getPageCount();
            const pages = await mergedPdf.copyPages(pdfDoc, pdfDoc.getPageIndices());
            
            for (const page of pages) {
                mergedPdf.addPage(page);
            }
            
            pageMapping.push({
                docId,
                startPage,
                endPage: mergedPdf.getPageCount() - 1,
                totalPages: pdfDoc.getPageCount()
            });
        }

        // Get all recipient tabs
        const tabs = getAllRecipientTabs(templateData);
        console.log(`Found ${tabs.length} tabs to process`);

        // Process each tab and add form fields
        for (let i = 0; i < tabs.length; i++) {
            const tab = tabs[i];
            const tabType = (tab.tabType || tab.type || '').toLowerCase();
            const docId = tab.documentId ? String(tab.documentId) : null;
            const pageNumber = parseInt(tab.pageNumber || tab.page || 1);

            // Find the correct page in the merged PDF
            const pageMappingEntry = pageMapping.find(mapping => mapping.docId === docId);
            if (!pageMappingEntry) {
                console.warn(`No page mapping found for document ID ${docId}`);
                continue;
            }

            const absolutePageIndex = pageMappingEntry.startPage + Math.max(0, pageNumber - 1);
            if (absolutePageIndex >= mergedPdf.getPageCount()) {
                console.warn(`Page ${pageNumber} not found in document ${docId}`);
                continue;
            }

            const page = mergedPdf.getPage(absolutePageIndex);
            const pageSize = page.getSize();
            
        // Convert tab coordinates
        const rect = getTabRectangle(tab, pageSize, options);
        if (!rect) {
            console.warn(`Invalid coordinates for tab ${i}`);
            continue;
        }

        // Skip tabs that are likely system/hidden tabs
        const x = parseFloat(tab.xPosition || tab.xPositionString || 0);
        const y = parseFloat(tab.yPosition || tab.yPositionString || 0);
        const width = parseFloat(tab.width || tab.widthString || 0);
        const height = parseFloat(tab.height || tab.heightString || 0);
        
        // Skip system tabs if option is disabled
        if (!options.includeSystemTabs) {
            // More sophisticated filtering for system tabs:
            // 1. Skip tabs with no meaningful dimensions (both width and height are 0 or very small)
            // 2. Skip tabs that are likely system-generated based on naming patterns
            // 3. Skip tabs that appear to be at origin AND have no meaningful content
            const isVerySmall = (width <= 1 && height <= 1);
            const isAtOrigin = (x === 0 && y === 0);
            const hasSystemName = tab.tabLabel && (
                tab.tabLabel.includes('_') && 
                /^\d+_\d+$/.test(tab.tabLabel) || // Pattern like "70081311_237"
                tab.tabLabel.toLowerCase().includes('system') ||
                tab.tabLabel.toLowerCase().includes('hidden')
            );
            const hasNoContent = !tab.value && !tab.defaultValue && !tab.text;
            
            // Only skip if it's both very small AND at origin, OR if it has a system name pattern
            if ((isVerySmall && isAtOrigin) || hasSystemName) {
                if (options.debugMode) {
                    console.log(`Skipping likely system tab: ${tab.tabLabel || 'unnamed'} at (${x}, ${y}) size ${width}x${height}`);
                }
                continue;
            }
        }

        // Create form field based on tab type
        const fieldName = getTabName(tab, i);
        let defaultValue = tab.value || tab.defaultValue || '';
        
        // Show field names as placeholders if option is enabled
        if (options.showFieldNames && !defaultValue) {
            defaultValue = `[${fieldName}]`;
        }

        // Debug logging
        if (options.debugMode) {
            console.log(`Processing tab ${i}: ${fieldName} (${tabType.toUpperCase()}) at (${x}, ${y}) size ${width}x${height} on page ${pageNumber}`);
        }
        
        if (tabType.includes('text') || tab.font || tab.text) {
            await createTextField(mergedPdf, page, fieldName, rect, defaultValue, options);
        } else if (tabType.includes('signhere') || tabType.includes('initialhere')) {
            // Check if signature fields should be included
            if (options.includeSignatureFields) {
                await createSignatureField(mergedPdf, page, fieldName, rect, options);
            } else {
                // Skip signature fields entirely if option is disabled
                if (options.debugMode) {
                    console.log(`Skipping signature field "${fieldName}" - signature fields disabled`);
                }
            }
        } else if (tabType.includes('datesigned') || tabType.includes('date')) {
            await createDateField(mergedPdf, page, fieldName, rect, options);
        } else {
            // Default to text field
            await createTextField(mergedPdf, page, fieldName, rect, defaultValue, options);
        }
        }

        // Apply masking if requested
        if (options.maskHeaderHeight > 0 || options.maskFooterHeight > 0) {
            await applyMasking(mergedPdf, options.maskHeaderHeight, options.maskFooterHeight);
        }

        // Return the final PDF as bytes
        return await mergedPdf.save();
        
    } catch (error) {
        console.error('PDF conversion error:', error);
        throw new Error(`PDF conversion failed: ${error.message}`);
    }
}

/**
 * Extract all recipient tabs from the template data
 * @param {Object} templateData - The template JSON data
 * @returns {Array} - Array of tab objects
 */
function getAllRecipientTabs(templateData) {
    const tabs = [];
    const recipients = templateData.recipients || {};
    
    // Collect tabs from signers, agents, and editors
    const recipientTypes = ['signers', 'agents', 'editors'];
    for (const type of recipientTypes) {
        const recipientsOfType = recipients[type] || [];
        for (const recipient of recipientsOfType) {
            const recipientTabs = recipient.tabs || {};
            for (const tabList of Object.values(recipientTabs)) {
                if (Array.isArray(tabList)) {
                    tabs.push(...tabList);
                }
            }
        }
    }
    
    // Collect tabs from recipientTabs array (legacy format)
    const recipientTabs = templateData.recipientTabs || [];
    for (const rt of recipientTabs) {
        if (typeof rt === 'object') {
            for (const tabList of Object.values(rt)) {
                if (Array.isArray(tabList)) {
                    tabs.push(...tabList);
                }
            }
        }
    }
    
    return tabs;
}

/**
 * Get the rectangle coordinates for a tab, converted to PDF coordinate system
 * @param {Object} tab - The tab object
 * @param {Object} pageSize - The page size object with width and height
 * @param {Object} options - Styling options
 * @returns {Object|null} - Rectangle object or null if invalid
 */
function getTabRectangle(tab, pageSize, options = {}) {
    try {
        const x = parseFloat(tab.xPosition || tab.xPositionString || 0);
        const y = parseFloat(tab.yPosition || tab.yPositionString || 0);
        const width = parseFloat(tab.width || tab.widthString || options.fieldWidth || DEFAULT_TEXT_FIELD_WIDTH);
        const height = parseFloat(tab.height || tab.heightString || options.fieldHeight || DEFAULT_TEXT_FIELD_HEIGHT);
        
        // Convert from DocuSign coordinates (top-left origin) to PDF coordinates (bottom-left origin)
        const llx = x;
        const lly = pageSize.height - (y + height);
        const urx = x + width;
        const ury = pageSize.height - y;
        
        return { llx, lly, urx, ury };
    } catch (error) {
        console.warn('Invalid tab coordinates:', error);
        return null;
    }
}

/**
 * Generate a field name for a tab
 * @param {Object} tab - The tab object
 * @param {number} index - The tab index
 * @returns {string} - The field name
 */
function getTabName(tab, index) {
    const label = tab.tabLabel || tab.name || tab.documentId || 'Field';
    return `${label}_${index}`;
}



/**
 * Create a text field on a page
 * @param {PDFDocument} pdfDoc - The PDF document
 * @param {PDFPage} page - The page to add the field to
 * @param {string} name - The field name
 * @param {Object} rect - The field rectangle
 * @param {string} defaultValue - The default value
 * @param {Object} options - Styling options
 */
async function createTextField(pdfDoc, page, name, rect, defaultValue = '', options = {}) {
    const form = pdfDoc.getForm();
    const textField = form.createTextField(name);
    textField.setText(defaultValue);
    
    // Add the field to the page with basic styling
    textField.addToPage(page, {
        x: rect.llx,
        y: rect.lly,
        width: rect.urx - rect.llx,
        height: rect.ury - rect.lly,
    });
    
    // Note: Advanced font styling is limited in PDF-lib's form field API
    // The field will use the PDF's default font and styling
    console.log(`Created text field "${name}" with default styling`);
}


/**
 * Create a signature field on a page
 * @param {PDFDocument} pdfDoc - The PDF document
 * @param {PDFPage} page - The page to add the field to
 * @param {string} name - The field name
 * @param {Object} rect - The field rectangle
 * @param {Object} options - Styling options
 */
async function createSignatureField(pdfDoc, page, name, rect, options = {}) {
    const form = pdfDoc.getForm();
    
    if (options.signatureAsText) {
        // Create a text field with "[Signature]" placeholder as before
        await createTextField(pdfDoc, page, name, rect, '[Signature]', options);
        console.log(`Created signature text placeholder "${name}"`);
    } else {
        // Create a proper PDF signature field using PDF-lib's signature field API
        try {
            const signatureField = form.createSignatureField(name);
            
            // Add the signature field to the page
            signatureField.addToPage(page, {
                x: rect.llx,
                y: rect.lly,
                width: rect.urx - rect.llx,
                height: rect.ury - rect.lly,
            });
            
            console.log(`Created interactive signature field "${name}"`);
        } catch (error) {
            // Fallback to text field if signature field creation fails
            console.warn(`Failed to create signature field "${name}", falling back to text field:`, error);
            await createTextField(pdfDoc, page, name, rect, '[Signature]', options);
        }
    }
}

/**
 * Create a date field on a page
 * @param {PDFDocument} pdfDoc - The PDF document
 * @param {PDFPage} page - The page to add the field to
 * @param {string} name - The field name
 * @param {Object} rect - The field rectangle
 * @param {Object} options - Styling options
 */
async function createDateField(pdfDoc, page, name, rect, options = {}) {
    // For date fields, we'll create a text field as a placeholder
    await createTextField(pdfDoc, page, name, rect, '[Date]', options);
}

/**
 * Apply header and footer masking to all pages
 * @param {PDFDocument} pdfDoc - The PDF document
 * @param {number} headerHeight - Height to mask from top
 * @param {number} footerHeight - Height to mask from bottom
 */
async function applyMasking(pdfDoc, headerHeight, footerHeight) {
    const pages = pdfDoc.getPages();
    
    for (const page of pages) {
        const pageSize = page.getSize();
        
        // Draw white rectangles to mask header and footer
        if (headerHeight > 0) {
            page.drawRectangle({
                x: 0,
                y: pageSize.height - headerHeight,
                width: pageSize.width,
                height: headerHeight,
                color: PDFLib.rgb(1, 1, 1), // White
            });
        }
        
        if (footerHeight > 0) {
            page.drawRectangle({
                x: 0,
                y: 0,
                width: pageSize.width,
                height: footerHeight,
                color: PDFLib.rgb(1, 1, 1), // White
            });
        }
    }
}

/**
 * Convert base64 string to Uint8Array
 * @param {string} base64 - The base64 string
 * @returns {Uint8Array} - The decoded bytes
 */
function base64ToUint8Array(base64) {
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes;
}

// Export the main function for use in the HTML
window.convertDocuSignToPDF = convertDocuSignToPDF;
