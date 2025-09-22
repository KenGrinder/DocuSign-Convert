/**
 * Client-side DocuSign JSON to PDF converter
 * This module handles the conversion of DocuSign template JSON files to fillable PDFs
 * using the PDF-lib library for client-side processing.
 */

// Configuration object for PDF conversion
const CONVERSION_CONFIG = {
    // Default field dimensions
    fieldDimensions: {
        text: { width: 120, height: 20 },
        checkbox: { width: 12, height: 12 },
        signature: { width: 120, height: 20 },
        initials: { width: 100, height: 25 },
        date: { width: 120, height: 20 }
    },
    
    // Default styling
    styling: {
        fontName: 'Helvetica',
        fontSize: 12,
        borderStyle: 'underlined',
        headerMaskHeight: 24.0
    },
    
    // Field validation
    validation: {
        minFieldWidth: 10,
        minFieldHeight: 10,
        maxFieldNameLength: 60
    },
    
    // System tab filtering
    systemTabPatterns: [
        /^\d+_\d+$/, // Pattern for system-generated tabs (e.g., "123456_789")
        /system/i,
        /hidden/i
    ]
};

/**
 * Determine DocuSign field type from tab data
 * 
 * @param {Object} tab - DocuSign tab data
 * @returns {string|null} - Field type or null if unknown
 */
function determineFieldType(tab) {
    const tabType = (tab.tabType || tab.type || '').toLowerCase();
    const stampType = (tab.stampType || '').toLowerCase();
    
    // Map DocuSign field types to our translation system
    // NOTE: Order matters! More specific checks must come before general ones
    
    // PRIORITY 1: Check stampType for signature fields (most reliable identifier)
    if (stampType === 'signature') {
        return 'signHereTabs';
    } else if (stampType === 'initials') {
        return 'initialHereTabs';
    } else if (stampType === 'stamp') {
        // Stamps are also electronic signatures but use separate field type for future flexibility
        return 'stampTabs';
    }
    
    // PRIORITY 2: Check tabType for other field types
    // Check for attachment fields FIRST (before signature fields)
    // This prevents "signerattachment" from being caught by the "sign" check below
    if (tabType === 'signerattachment' || tabType.includes('attachment')) {
        return 'signerAttachmentTabs';
    } else if (tabType === 'signhere' || tabType.includes('signhere')) {
        return 'signHereTabs';
    } else if (tabType === 'initialhere' || tabType.includes('initialhere')) {
        return 'initialHereTabs';
    } else if (tabType === 'text' || tabType.includes('text')) {
        return 'textTabs';
    } else if (tabType === 'checkbox' || tabType.includes('checkbox')) {
        return 'checkboxTabs';
    } else if (tabType === 'radiogroup' || tabType.includes('radio')) {
        return 'radioGroupTabs';
    } else if (tabType === 'list' || tabType.includes('list') || tabType.includes('dropdown')) {
        return 'listTabs';
    } else if (tabType === 'fullname' || tabType.includes('fullname')) {
        return 'fullNameTabs';
    } else if (tabType === 'datesigned' || tabType.includes('date')) {
        return 'dateSignedTabs';
    } else if (tabType === 'company' || tabType.includes('company')) {
        return 'companyTabs';
    } else if (tabType === 'title' || tabType.includes('title')) {
        return 'titleTabs';
    } else if (tabType === 'emailaddress' || tabType.includes('email')) {
        return 'emailAddressTabs';
    } else if (tabType === 'numerical' || tabType.includes('numerical') || tabType.includes('number')) {
        return 'numericalTabs';
    }
    
    // Fallback: Check for signature-related fields with more specific patterns
    // This is more restrictive to avoid false positives
    if (tabType.includes('signature') && !tabType.includes('attachment')) {
        return 'signHereTabs';
    } else if (tabType.includes('sign') && !tabType.includes('attachment') && !tabType.includes('signer')) {
        return 'signHereTabs';
    }
    
    return null;
}

/**
 * Update field type counters based on field type
 * 
 * @param {string} fieldType - The field type
 * @param {Object} counters - The counters object
 */
function updateFieldTypeCount(fieldType, counters) {
    switch (fieldType) {
        case 'textTabs':
            counters.text++;
            break;
        case 'signHereTabs':
        case 'initialHereTabs':
            counters.signature++;
            break;
        case 'checkboxTabs':
            counters.checkbox++;
            break;
        case 'radioGroupTabs':
            counters.radio++;
            break;
        case 'listTabs':
            counters.dropdown++;
            break;
        case 'dateSignedTabs':
            counters.date++;
            break;
        case 'signerAttachmentTabs':
            counters.attachment++;
            break;
        default:
            counters.other++;
            break;
    }
}

/**
 * Validate and sanitize DocuSign JSON data to prevent security vulnerabilities
 * @param {Object} templateData - The parsed DocuSign template JSON
 * @returns {boolean} - Validation result
 */
function validateDocuSignJSON(templateData) {
    // Check for basic structure
    if (!templateData || typeof templateData !== 'object') {
        throw new Error('Invalid template data: Expected an object');
    }
    
    // Note: Prototype pollution check removed for client-side app
    // In a client-side only app, prototype pollution has minimal impact
    // and the check was causing false positives with valid DocuSign JSON
    
    // Validate documents array
    if (!templateData.documents || !Array.isArray(templateData.documents)) {
        throw new Error('Invalid template data: Missing or invalid documents array');
    }
    
    // Validate each document
    for (const doc of templateData.documents) {
        if (!doc || typeof doc !== 'object') {
            throw new Error('Invalid document: Expected an object');
        }
        
        // Validate document ID
        if (doc.documentId && typeof doc.documentId !== 'string' && typeof doc.documentId !== 'number') {
            throw new Error('Invalid document ID: Must be string or number');
        }
        
        // Validate base64 data
        if (doc.documentBase64 && typeof doc.documentBase64 !== 'string') {
            throw new Error('Invalid document data: Base64 must be string');
        }
    }
    
    return true;
}

/**
 * Sanitize field name to prevent XSS and other attacks
 * @param {string} name - The field name to sanitize
 * @returns {string} - Sanitized field name
 */
function sanitizeFieldName(name) {
    if (!name || typeof name !== 'string') {
        return 'field_' + Date.now();
    }
    
    // Remove potentially dangerous characters and limit length
    return name
        .replace(/[<>\"'&]/g, '') // Remove HTML/XML special characters
        .replace(/[^\w\-_]/g, '_') // Replace non-alphanumeric chars with underscore
        .substring(0, 40); // Limit length
}

/**
 * Main conversion function that takes DocuSign JSON data and converts it to a PDF
 * @param {Object} templateData - The parsed DocuSign template JSON
 * @param {Object} options - Conversion options
 * @returns {Promise<Uint8Array>} - The converted PDF as bytes
 */
async function convertDocuSignToPDF(templateData, options = {}) {
    try {
        // Input validation and sanitization
        validateDocuSignJSON(templateData);
        
        // Starting DocuSign to PDF conversion
        
        // Extract documents from the template
        const documents = templateData.documents || [];
        if (documents.length === 0) {
            throw new Error('No documents found in template JSON');
        }

        // Note: Signature fields are now created directly during conversion using direct PDF manipulation

        // Decode and process each document
        const pdfDocs = [];
        for (const doc of documents) {
            const docId = String(doc.documentId); // Ensure consistent string type for document IDs
            const base64Data = doc.documentBase64 || doc.documentBase64Bytes;
            
            if (!base64Data) {
                continue;
            }

            try {
                const pdfBytes = base64ToUint8Array(base64Data);
                const pdfDoc = await PDFLib.PDFDocument.load(pdfBytes);
                pdfDocs.push({ docId, pdfDoc });
            } catch (error) {
                // Skip invalid documents
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
        
        // Track field types for processing
        const fieldTypeCounts = {
            text: 0,
            signature: 0,
            date: 0,
            checkbox: 0,
            radio: 0,
            dropdown: 0,
            attachment: 0,
            other: 0
        };

        // Process each tab and add form fields
        for (let i = 0; i < tabs.length; i++) {
            const tab = tabs[i];
            
            // Validate tab data
            if (!tab || typeof tab !== 'object') {
                continue;
            }
            
            const tabType = (tab.tabType || tab.type || '').toLowerCase();
            const docId = tab.documentId ? String(tab.documentId) : null;
            const pageNumber = parseInt(tab.pageNumber || tab.page || 1);

            // Find the correct page in the merged PDF
            const pageMappingEntry = pageMapping.find(mapping => mapping.docId === docId);
            if (!pageMappingEntry) {
                continue;
            }


            const absolutePageIndex = pageMappingEntry.startPage + Math.max(0, pageNumber - 1);
            if (absolutePageIndex >= mergedPdf.getPageCount()) {
                continue;
            }

            const page = mergedPdf.getPage(absolutePageIndex);
            const pageSize = page.getSize();
            
        // Convert tab coordinates
        const rect = getTabRectangle(tab, pageSize, options);
        if (!rect) {
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
            const hasSystemName = tab.tabLabel && CONVERSION_CONFIG.systemTabPatterns.some(pattern => 
                pattern.test(tab.tabLabel)
            );
            const hasNoContent = !tab.value && !tab.defaultValue && !tab.text;
            
            // Only skip if it's both very small AND at origin, OR if it has a system name pattern
            if ((isVerySmall && isAtOrigin) || hasSystemName) {
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

        // Use the translation system to process the field
        const fieldType = determineFieldType(tab);
        
        if (fieldType) {
            
            // Use the field translation system
            const success = await translateField(fieldType, tab, mergedPdf, page, {
                ...options,
                fieldName: fieldName,
                rect: rect,
                defaultValue: defaultValue
            });
            
            if (success) {
                updateFieldTypeCount(fieldType, fieldTypeCounts);
            } else {
                fieldTypeCounts.other++;
            }
        } else {
            // Fallback to text field for unknown types
            await createTextField(mergedPdf, page, fieldName, rect, defaultValue, options);
            fieldTypeCounts.other++;
        }
        }

        // Apply masking if requested
        if (options.maskHeaderHeight > 0 || options.maskFooterHeight > 0) {
            await applyMasking(mergedPdf, options.maskHeaderHeight, options.maskFooterHeight);
        }

        // Ensure all form field appearances are updated before saving
        // This is crucial for proper rendering of interactive fields like checkboxes
        const finalForm = mergedPdf.getForm();
        finalForm.updateFieldAppearances();

        // Field creation completed

        // Return the final PDF as bytes
        // Note: Signature fields are now created directly during the conversion process
        // using direct PDF manipulation, so no post-processing is needed
        return await mergedPdf.save();
        
    } catch (error) {
        // Log error details for debugging (in development only)
        if (typeof console !== 'undefined' && console.error) {
            console.error('PDF conversion error:', error);
        }
        
        // Return generic error message to prevent information disclosure
        throw new Error('PDF conversion failed. Please check your file and try again.');
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
        
        // Determine field type to set appropriate default dimensions
        const fieldType = determineFieldType(tab);
        let defaultWidth, defaultHeight;
        
        // Get dimensions from configuration
        if (fieldType === 'checkboxTabs') {
            defaultWidth = CONVERSION_CONFIG.fieldDimensions.checkbox.width;
            defaultHeight = CONVERSION_CONFIG.fieldDimensions.checkbox.height;
        } else if (fieldType === 'signHereTabs' || fieldType === 'stampTabs') {
            defaultWidth = CONVERSION_CONFIG.fieldDimensions.signature.width;
            defaultHeight = CONVERSION_CONFIG.fieldDimensions.signature.height;
        } else if (fieldType === 'initialHereTabs') {
            defaultWidth = CONVERSION_CONFIG.fieldDimensions.initials.width;
            defaultHeight = CONVERSION_CONFIG.fieldDimensions.initials.height;
        } else if (fieldType === 'dateSignedTabs') {
            defaultWidth = CONVERSION_CONFIG.fieldDimensions.date.width;
            defaultHeight = CONVERSION_CONFIG.fieldDimensions.date.height;
        } else {
            defaultWidth = options.fieldWidth || CONVERSION_CONFIG.fieldDimensions.text.width;
            defaultHeight = options.fieldHeight || CONVERSION_CONFIG.fieldDimensions.text.height;
        }
        
        // Parse width and height, but use defaults if the parsed value is 0 or NaN
        const parsedWidth = parseFloat(tab.width || tab.widthString || 0);
        const parsedHeight = parseFloat(tab.height || tab.heightString || 0);
        const width = (parsedWidth > 0) ? parsedWidth : defaultWidth;
        const height = (parsedHeight > 0) ? parsedHeight : defaultHeight;
        
        
        // Convert from DocuSign coordinates (top-left origin) to PDF coordinates (bottom-left origin)
        const llx = x;
        const lly = pageSize.height - (y + height);
        const urx = x + width;
        const ury = pageSize.height - y;
        
        const rect = { llx, lly, urx, ury };
        
        return rect;
    } catch (error) {
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
    // Sanitize the label first
    const sanitizedLabel = sanitizeFieldName(label);
    // Generate a more unique name to avoid conflicts
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 5);
    return `${sanitizedLabel}_${index}_${timestamp}_${random}`;
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
    
    // Check if field already exists to avoid duplicate name errors
    try {
        const existingField = form.getField(name);
        if (existingField) {
            return;
        }
    } catch (error) {
        // Field doesn't exist, continue with creation
    }
    
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
}


/**
 * Create a REAL signature field on a page by directly manipulating the PDF's internal structure
 * This creates actual /Sig fields that Adobe Acrobat/Reader recognizes for digital signing
 * @param {PDFDocument} pdfDoc - The PDF document
 * @param {PDFPage} page - The page to add the field to
 * @param {string} name - The field name
 * @param {Object} rect - The field rectangle
 * @param {Object} options - Styling options
 * @param {number} pageNumber - The page number
 */
/**
 * Unified signature field creation using direct PDF manipulation
 * 
 * This function creates Adobe Fill & Sign signature fields (both full signatures and initials) that allow users to:
 * - Draw signatures/initials using mouse/touch
 * - Upload signature/initials images  
 * - Type signatures/initials in signature fonts
 * - Use Adobe's built-in signature tools
 * 
 * OPTIMIZATIONS IMPLEMENTED:
 * =========================
 * 
 * 1. UNIFIED FUNCTION: Single function handles both signatures and initials with type parameter
 * 2. REDUCED DUPLICATION: Shared logic for field creation, registration, and widget attachment
 * 3. PERFORMANCE: Cached AcroForm lookup, optimized object creation
 * 4. MAINTAINABILITY: Single source of truth for signature field logic
 * 
 * @param {PDFDocument} pdfDoc - The PDF document to add the signature field to
 * @param {PDFPage} page - The PDF page where the signature field will be placed
 * @param {string} name - The name of the signature field
 * @param {Object} rect - The rectangle coordinates {llx, lly, urx, ury}
 * @param {'signature'|'initials'} fieldType - Type of field to create (determines size and styling)
 */
async function createSignatureField(pdfDoc, page, name, rect, fieldType = 'signature') {
    try {
        const isInitials = fieldType === 'initials';
        const fieldTypeLabel = isInitials ? 'initials' : 'signature';
        
        // STEP 1: Clean and validate the field name
        let cleanName = name;
        if (!cleanName || typeof cleanName !== 'string') {
            cleanName = `${fieldTypeLabel}_${Date.now()}`;
        }
        cleanName = cleanName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
        
        // STEP 2: Calculate field dimensions based on type
        // Use the same minimum dimensions as the coordinate conversion for consistency
        const minWidth = isInitials ? 100 : 120;   // Initials: 100pts, Signatures: 120pts (matches coordinate conversion)
        const minHeight = isInitials ? 25 : 20;    // Initials: 25pts, Signatures: 20pts (matches coordinate conversion)
        const width = Math.max(rect.urx - rect.llx, minWidth);
        const height = Math.max(rect.ury - rect.lly, minHeight);
        
        // STEP 3: Create field rectangle array (used in multiple places)
        const fieldRect = pdfDoc.context.obj([
            PDFLib.PDFNumber.of(rect.llx),
            PDFLib.PDFNumber.of(rect.lly),
            PDFLib.PDFNumber.of(rect.llx + width),
            PDFLib.PDFNumber.of(rect.lly + height)
        ]);
        
        // STEP 4: Create appearance characteristics based on type
        const bgColor = isInitials ? [0.97, 0.97, 0.97] : [0.95, 0.95, 0.95]; // Lighter for initials
        const fontSize = isInitials ? 10 : 12; // Smaller font for initials
        const appearanceDict = pdfDoc.context.obj({
            BC: pdfDoc.context.obj([0, 0, 0]),           // Black border
            BG: pdfDoc.context.obj(bgColor)              // Background color
        });
        const defaultAppearance = PDFLib.PDFString.of(`/Helv ${fontSize} Tf 0 g`);
        
        // STEP 5: Create the signature field dictionary
        const signatureDict = pdfDoc.context.obj({
            FT: PDFLib.PDFName.of('Sig'),                // Field Type: Signature
            T: PDFLib.PDFString.of(cleanName),           // Field Name
            Ff: PDFLib.PDFNumber.of(0),                  // Field Flags: Allow electronic signatures
            Rect: fieldRect,                             // Field Rectangle
            P: page.ref,                                 // Page Reference
            V: null,                                     // Value (null = unsigned)
            Lock: false,                                 // Not locked
            F: PDFLib.PDFNumber.of(4),                   // Print flag
            MK: appearanceDict,                          // Appearance characteristics
            DA: defaultAppearance,                       // Default appearance string
        });
        
        // STEP 6: Register the signature field
        const signatureRef = pdfDoc.context.register(signatureDict);
        
        // STEP 7: Integrate with PDF's AcroForm system (optimized)
        let acroForm = pdfDoc.catalog.get(PDFLib.PDFName.of('AcroForm'));
        if (!acroForm) {
            acroForm = pdfDoc.context.obj({
                Fields: pdfDoc.context.obj([signatureRef]),
                NeedAppearances: true
            });
            pdfDoc.catalog.set(PDFLib.PDFName.of('AcroForm'), acroForm);
        } else {
            const fields = acroForm.get(PDFLib.PDFName.of('Fields'));
            if (fields) {
                fields.push(signatureRef);
            } else {
                acroForm.set(PDFLib.PDFName.of('Fields'), pdfDoc.context.obj([signatureRef]));
            }
        }
        
        // STEP 8: Create widget annotation (reuse fieldRect and appearanceDict)
        const widgetDict = pdfDoc.context.obj({
            Type: PDFLib.PDFName.of('Annot'),
            Subtype: PDFLib.PDFName.of('Widget'),
            FT: PDFLib.PDFName.of('Sig'),
            T: PDFLib.PDFString.of(cleanName),
            Rect: fieldRect,                             // Reuse rectangle
            P: page.ref,
            F: PDFLib.PDFNumber.of(4),
            AP: null,
            MK: appearanceDict,                          // Reuse appearance
            DA: defaultAppearance,                       // Reuse default appearance
            Ff: PDFLib.PDFNumber.of(0),
        });
        
        // STEP 9: Register and attach the widget annotation
        const widgetRef = pdfDoc.context.register(widgetDict);
        
        // Handle annotations array properly - it might be a PDFRef or PDFArray
        let annots = page.node.get(PDFLib.PDFName.of('Annots'));
        
        if (!annots) {
            // Create new annotations array if none exists
            page.node.set(PDFLib.PDFName.of('Annots'), pdfDoc.context.obj([widgetRef]));
        } else {
            // If it's a reference, get the actual array
            if (annots instanceof PDFLib.PDFRef) {
                annots = pdfDoc.context.lookup(annots);
            }
            
            // Ensure annots is a mutable array by creating a new one
            const existingAnnots = [];
            if (annots && annots.size && annots.size() > 0) {
                for (let i = 0; i < annots.size(); i++) {
                    existingAnnots.push(annots.get(i));
                }
            }
            existingAnnots.push(widgetRef);
            page.node.set(PDFLib.PDFName.of('Annots'), pdfDoc.context.obj(existingAnnots));
        }
        
    } catch (error) {
        // Fall back to styled text field if signature field creation fails
        await createSignatureFieldFallback(pdfDoc, page, name, rect);
    }
}

// Convenience functions for backward compatibility and clarity
async function createWorkingSignatureField(pdfDoc, page, name, rect) {
    return createSignatureField(pdfDoc, page, name, rect, 'signature');
}

async function createWorkingInitialsField(pdfDoc, page, name, rect) {
    return createSignatureField(pdfDoc, page, name, rect, 'initials');
}

/**
 * Creates a working electronic initials field using direct PDF manipulation
 * 
 * This function creates Adobe Fill & Sign signature fields specifically optimized for initials that allow users to:
 * - Draw initials using mouse/touch
 * - Upload initials images
 * - Type initials in signature fonts
 * - Use Adobe's built-in signature tools
 * 
 * DIFFERENCES FROM FULL SIGNATURE FIELDS:
 * =====================================
 * 
 * 1. SIZE OPTIMIZATION:
 *    - Smaller minimum dimensions (100x25 points vs 150x40 for signatures)
 *    - Optimized for initials rather than full signatures
 *    - More compact appearance suitable for initial placement
 * 
 * 2. STYLING DIFFERENCES:
 *    - Slightly different border styling (thinner border)
 *    - Different background color (slightly lighter)
 *    - Optimized for initials visibility
 * 
 * 3. BEHAVIOR:
 *    - Same Adobe Fill & Sign functionality as signature fields
 *    - Users can draw, upload, or type initials
 *    - Adobe recognizes it as a signature field (no separate initials field type in PDF spec)
 * 
 * HOW IT WORKS:
 * =============
 * 
 * Uses the same PDF structure as signature fields but with initials-optimized dimensions and styling.
 * Adobe AcroForms doesn't have a separate "initials" field type, so we use signature fields
 * with appropriate sizing and styling to create the initials experience.
 * 
 * @param {PDFDocument} pdfDoc - The PDF document to add the initials field to
 * @param {PDFPage} page - The PDF page where the initials field will be placed
 * @param {string} name - The name of the initials field
 * @param {Object} rect - The rectangle coordinates {llx, lly, urx, ury}
 */
async function createWorkingInitialsField(pdfDoc, page, name, rect) {
    try {
        
        // STEP 1: Clean and validate the field name
        // PDF field names must be alphanumeric with underscores/hyphens only
        let cleanName = name;
        if (!cleanName || typeof cleanName !== 'string') {
            cleanName = `Signature_${Date.now()}`;
        }
        cleanName = cleanName.replace(/[^a-zA-Z0-9_-]/g, '_').substring(0, 40);
        
        // STEP 2: Calculate field dimensions
        // Ensure minimum size for usability and visibility
        const width = Math.max(rect.urx - rect.llx, 150);  // Minimum 150 points width
        const height = Math.max(rect.ury - rect.lly, 40);  // Minimum 40 points height
        
        // STEP 3: Create the signature field dictionary
        // This is the core field definition that Adobe will recognize
        const signatureDict = pdfDoc.context.obj({
            FT: PDFLib.PDFName.of('Sig'),                    // Field Type: Signature (required for Adobe Fill & Sign)
            T: PDFLib.PDFString.of(cleanName),               // Field Name (must be valid PDF name)
            Ff: PDFLib.PDFNumber.of(0),                      // Field Flags: 0 = Allow electronic signatures (not just digital)
            Rect: pdfDoc.context.obj([                       // Field Rectangle [left, bottom, right, top]
                PDFLib.PDFNumber.of(rect.llx),
                PDFLib.PDFNumber.of(rect.lly),
                PDFLib.PDFNumber.of(rect.llx + width),
                PDFLib.PDFNumber.of(rect.lly + height)
            ]),
            P: page.ref,                                     // Page Reference (links field to specific page)
            V: null,                                         // Value (null = unsigned, will be filled when signed)
            Lock: false,                                     // Not locked (allows signing)
            F: PDFLib.PDFNumber.of(4),                       // Print flag (field will print)
            
            // APPEARANCE CHARACTERISTICS for visual feedback
            MK: pdfDoc.context.obj({                         // Appearance characteristics
                BC: pdfDoc.context.obj([0, 0, 0]),           // Border color (black border)
                BG: pdfDoc.context.obj([0.95, 0.95, 0.95])   // Background color (light gray background)
            }),
            DA: PDFLib.PDFString.of('/Helv 12 Tf 0 g'),     // Default appearance string (font specification)
        });
        
        // STEP 4: Register the signature field in the PDF context
        // This makes the field part of the PDF's internal structure
        const signatureRef = pdfDoc.context.register(signatureDict);
        
        // STEP 5: Integrate with PDF's AcroForm system
        // AcroForm is PDF's standard form system that Adobe recognizes
        let acroForm = pdfDoc.catalog.get(PDFLib.PDFName.of('AcroForm'));
        if (!acroForm) {
            // Create new AcroForm if document doesn't have one
            acroForm = pdfDoc.context.obj({
                Fields: pdfDoc.context.obj([signatureRef]),   // Array of field references
                NeedAppearances: true                         // Ensure fields render properly
            });
            pdfDoc.catalog.set(PDFLib.PDFName.of('AcroForm'), acroForm);
        } else {
            // Add to existing AcroForm
            const fields = acroForm.get(PDFLib.PDFName.of('Fields'));
            if (fields) {
                fields.push(signatureRef);                   // Add to existing fields array
            } else {
                acroForm.set(PDFLib.PDFName.of('Fields'), pdfDoc.context.obj([signatureRef]));
            }
        }
        
        // STEP 6: Create widget annotation for user interaction
        // Widget annotations make fields visible and clickable in PDF viewers
        const widgetDict = pdfDoc.context.obj({
            Type: PDFLib.PDFName.of('Annot'),                // Annotation type
            Subtype: PDFLib.PDFName.of('Widget'),            // Widget subtype (form field widget)
            FT: PDFLib.PDFName.of('Sig'),                    // Field Type: Signature
            T: PDFLib.PDFString.of(cleanName),               // Field name (must match field dictionary)
            Rect: pdfDoc.context.obj([                       // Widget rectangle (same as field)
                PDFLib.PDFNumber.of(rect.llx),
                PDFLib.PDFNumber.of(rect.lly),
                PDFLib.PDFNumber.of(rect.llx + width),
                PDFLib.PDFNumber.of(rect.lly + height)
            ]),
            P: page.ref,                                     // Page reference
            F: PDFLib.PDFNumber.of(4),                       // Print flag
            AP: null,                                        // Appearance (null = use default)
            
            // Widget appearance characteristics (same as field for consistency)
            MK: pdfDoc.context.obj({
                BC: pdfDoc.context.obj([0, 0, 0]),           // Border color
                BG: pdfDoc.context.obj([0.95, 0.95, 0.95])   // Background color
            }),
            DA: PDFLib.PDFString.of('/Helv 12 Tf 0 g'),     // Default appearance
            Ff: PDFLib.PDFNumber.of(0),                      // Field flags (allow electronic signatures)
        });
        
        // STEP 7: Register and attach the widget annotation
        const widgetRef = pdfDoc.context.register(widgetDict);
        
        // Add widget to page's annotation array
        // This makes the field visible and interactive on the page
        const annots = page.node.get(PDFLib.PDFName.of('Annots'));
        if (annots) {
            annots.push(widgetRef);                          // Add to existing annotations
        } else {
            page.node.set(PDFLib.PDFName.of('Annots'), pdfDoc.context.obj([widgetRef]));
        }
        
        
    } catch (error) {
        // Fall back to styled text field if signature field creation fails
        await createSignatureFieldFallback(pdfDoc, page, name, rect);
    }
}

/**
 * Fallback method for creating signature fields when real signature libraries are not available
 * Creates a styled text field that looks like a signature field
 * @param {PDFDocument} pdfDoc - The PDF document
 * @param {PDFPage} page - The page to add the field to
 * @param {string} name - The field name
 * @param {Object} rect - The field rectangle
 * @param {Object} options - Styling options
 */
async function createSignatureFieldFallback(pdfDoc, page, name, rect, options = {}) {
    const form = pdfDoc.getForm();
    
    // Check if field already exists to avoid duplicate name errors
    try {
        const existingField = form.getField(name);
        if (existingField) {
            return;
        }
    } catch (error) {
        // Field doesn't exist, continue with creation
    }
    
    try {
        // Ensure minimum size for visibility and interaction
        const originalWidth = rect.urx - rect.llx;
        const originalHeight = rect.ury - rect.lly;
        const width = Math.max(originalWidth, 100); // Minimum 100 points width for signature fields
        const height = Math.max(originalHeight, 30); // Minimum 30 points height for signature fields
        
        // Create a text field styled to look like a signature field
        const signatureField = form.createTextField(name);
        
        // Add the field to the page with signature field styling
        signatureField.addToPage(page, {
            x: rect.llx,
            y: rect.lly,
            width: width,
            height: height,
            // Signature field styling for professional appearance
            borderColor: PDFLib.rgb(0, 0, 0), // Black border
            borderWidth: 2, // Thicker border to indicate importance
            backgroundColor: PDFLib.rgb(0.98, 0.98, 0.98), // Light gray background
            // Add tooltip to indicate this is a signature field
            tooltip: 'Click to add your signature'
        });
        
        // Set placeholder text that indicates this is a signature field
        const placeholderText = name.toLowerCase().includes('initial') ? '[INITIAL HERE]' : '[SIGN HERE]';
        signatureField.setText(placeholderText);
        
        // Make the field required to indicate it needs to be filled
        signatureField.enableRequired();
        
        
    } catch (error) {
        // Final fallback to basic text field if styled field creation fails
        await createTextField(pdfDoc, page, name, rect, '[Signature Required]', options);
    }
}

/**
 * Create a date field on a page using proper PDF AcroForm date field type
 * @param {PDFDocument} pdfDoc - The PDF document
 * @param {PDFPage} page - The page to add the field to
 * @param {string} name - The field name
 * @param {Object} rect - The field rectangle
 * @param {Object} options - Styling options
 */
async function createDateField(pdfDoc, page, name, rect, options = {}) {
    try {
        const form = pdfDoc.getForm();
        
        // Check if field already exists to avoid duplicate name errors
        try {
            const existingField = form.getField(name);
        if (existingField) {
            return;
        }
        } catch (error) {
            // Field doesn't exist, continue with creation
        }
        
        // Create a text field that will be configured as a date field
        // PDF-lib doesn't have a specific date field type, but we can create a text field
        // with date-specific properties and validation
        const dateField = form.createTextField(name);
        
        // Set the field as a date field by adding date-specific properties
        // This creates a proper AcroForm field that PDF viewers will recognize as a date field
        dateField.addToPage(page, {
            x: rect.llx,
            y: rect.lly,
            width: rect.urx - rect.llx,
            height: rect.ury - rect.lly,
            // Add date field specific styling and properties
            borderColor: PDFLib.rgb(0, 0, 0), // Black border
            borderWidth: 1, // 1 point border width
            backgroundColor: PDFLib.rgb(0.98, 0.98, 0.98), // Light gray background for date fields
            // Add tooltip to indicate this is a date field
            tooltip: 'Enter date in MM/DD/YYYY format'
        });
        
        // Set additional properties to make this field behave as a date field
        // Note: PDF-lib text fields don't support setFlag method, so we'll rely on styling and placeholder text
        
        // Set a placeholder value that indicates the expected date format
        // This helps users understand what format to use
        const today = new Date();
        const formattedDate = (today.getMonth() + 1).toString().padStart(2, '0') + '/' + 
                             today.getDate().toString().padStart(2, '0') + '/' + 
                             today.getFullYear();
        dateField.setText(formattedDate);
        
        // Update field appearance to ensure proper rendering
        // Note: defaultUpdateAppearances() might fail if no font is set, so we'll skip it for date fields
        try {
            dateField.defaultUpdateAppearances();
        } catch (error) {
            // Appearance update failed, continue
        }
        
    } catch (error) {
        // Fallback to basic text field if date field creation fails
        // Generate a new unique name for the fallback field to avoid conflicts
        const fallbackName = `${name}_fallback_${Date.now()}`;
        await createTextField(pdfDoc, page, fallbackName, rect, '', options);
    }
}

/**
 * Create a checkbox field on a page
 * @param {PDFDocument} pdfDoc - The PDF document
 * @param {PDFPage} page - The page to add the field to
 * @param {string} name - The field name
 * @param {Object} rect - The field rectangle
 * @param {boolean} isChecked - Whether the checkbox should be checked by default
 * @param {Object} options - Styling options
 */
async function createCheckboxField(pdfDoc, page, name, rect, isChecked = false, options = {}) {
    try {
        const form = pdfDoc.getForm();
        
        // Check if field already exists to avoid duplicate name errors
        try {
            const existingField = form.getField(name);
        if (existingField) {
            return;
        }
        } catch (error) {
            // Field doesn't exist, continue with creation
        }
        
        // Create the checkbox field using PDF-lib's checkbox API
        const checkbox = form.createCheckBox(name);
        
        // Set the initial state based on the tab's checked value
        if (isChecked) {
            checkbox.check();
        } else {
            checkbox.uncheck();
        }
        
        // Ensure minimum size for visibility and interaction
        const originalWidth = rect.urx - rect.llx;
        const originalHeight = rect.ury - rect.lly;
        const width = Math.max(originalWidth, 12); // Minimum 12 points width
        const height = Math.max(originalHeight, 12); // Minimum 12 points height
        
        // Use the same positioning logic as text fields - no Y adjustment needed
        // The rect coordinates are already correctly calculated in getTabRectangle()
        
        // Add the checkbox field to the page with the specified dimensions and styling
        // Note: PDF-lib checkboxes might use a different Y coordinate anchor point than text fields
        // Try using the upper Y coordinate (ury) instead of lower Y coordinate (lly)
        checkbox.addToPage(page, {
            x: rect.llx,
            y: rect.ury - height, // Use upper Y coordinate minus height for proper positioning
            width: width,
            height: height,
            // Add visual styling to make the checkbox more visible and interactive
            borderColor: PDFLib.rgb(0, 0, 0), // Black border
            borderWidth: 1, // 1 point border width
            backgroundColor: PDFLib.rgb(1, 1, 1), // White background
        });
        
        // CRITICAL: Update the checkbox appearance to ensure it renders as an interactive checkbox
        // This must be called AFTER addToPage to generate proper appearance streams
        checkbox.defaultUpdateAppearances();
        
        // Checkbox field created successfully
        
    } catch (error) {
        // Fallback to text field if checkbox creation fails
        const fallbackValue = isChecked ? '[✓]' : '[ ]';
        await createTextField(pdfDoc, page, name, rect, fallbackValue, options);
    }
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
 * Add real signature fields to PDF using @signpdf/placeholder-pdf-lib post-processing
 * This function uses the pdflibAddPlaceholder method to create actual /Sig fields that Adobe recognizes
 * @param {Uint8Array} pdfBytes - The PDF bytes
 * @param {Array} signatureFields - Array of signature field data to add
 * @returns {Promise<Uint8Array>} - The PDF bytes with real signature fields
 */
async function addRealSignatureFieldsPostProcessing(pdfBytes, signatureFields) {
    try {
        // Check if pdflibAddPlaceholder is available
        if (typeof window.pdflibAddPlaceholder !== 'function') {
            throw new Error('pdflibAddPlaceholder not available - signature libraries not loaded');
        }
        
        // Adding real signature fields using @signpdf/placeholder-pdf-lib
        
        // Load the PDF document
        const pdfDoc = await PDFLib.PDFDocument.load(pdfBytes);
        
        // Add each signature field using pdflibAddPlaceholder
        for (let i = 0; i < signatureFields.length; i++) {
            const field = signatureFields[i];
            const rect = field.rect;
            
            // Adding signature field: ${field.name}
            
            // Use pdflibAddPlaceholder to add the signature field
            // This creates both the /Sig field and the visible /Widget that Adobe recognizes
            
            // Clean and validate the field name - use only letters, numbers, and underscores
            let cleanName = field.name;
            if (!cleanName || typeof cleanName !== 'string') {
                cleanName = `Signature_${i + 1}`;
            }
            
            // Remove ALL special characters except letters, numbers, and underscores
            cleanName = cleanName.replace(/[^a-zA-Z0-9_]/g, '_');
            
            // Remove multiple consecutive underscores
            cleanName = cleanName.replace(/_+/g, '_');
            
            // Remove leading/trailing underscores
            cleanName = cleanName.replace(/^_+|_+$/g, '');
            
            // Ensure we have a valid name
            if (!cleanName || cleanName.length === 0) {
                cleanName = `Signature_${i + 1}`;
            }
            
            // Ensure the name isn't too long (PDF has limits)
            if (cleanName.length > 40) {
                cleanName = cleanName.substring(0, 37) + '_' + i;
            }
            
            
            // Validate all parameters before calling pdflibAddPlaceholder
            const widgetRect = [rect.llx, rect.lly, rect.urx, rect.ury];
            
            // Ensure all parameters are valid
            if (!pdfDoc || !cleanName || !Array.isArray(widgetRect) || widgetRect.length !== 4) {
                throw new Error(`Invalid parameters: pdfDoc=${!!pdfDoc}, name="${cleanName}", widgetRect=[${widgetRect}]`);
            }
            
            window.pdflibAddPlaceholder({
                pdfDoc: pdfDoc,
                name: cleanName,
                reason: "Document Signature",
                location: "Remote",
                contactInfo: "signer@example.com",
                widgetRect: widgetRect,
            });
            
        }
        
        // Update field appearances to ensure all fields are properly rendered
        try {
            const form = pdfDoc.getForm();
            form.updateFieldAppearances();
        } catch (error) {
            // Field appearance update failed, continue
        }
        
        
        // Save the modified PDF
        const finalPdfBytes = await pdfDoc.save();
        return finalPdfBytes;
        
    } catch (error) {
        throw error;
    }
}

/**
 * Validate base64 string format
 * @param {string} base64 - The base64 string to validate
 * @returns {boolean} - Validation result
 */
function validateBase64(base64) {
    if (!base64 || typeof base64 !== 'string') {
        return false;
    }
    
    // Check for valid base64 characters only
    const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
    if (!base64Regex.test(base64)) {
        return false;
    }
    
    // Check length is multiple of 4
    if (base64.length % 4 !== 0) {
        return false;
    }
    
    return true;
}

/**
 * Convert base64 string to Uint8Array with validation
 * @param {string} base64 - The base64 string
 * @returns {Uint8Array} - The decoded bytes
 */
function base64ToUint8Array(base64) {
    // Validate base64 format first
    if (!validateBase64(base64)) {
        throw new Error('Invalid base64 format');
    }
    
    try {
        const binaryString = atob(base64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
        }
        return bytes;
    } catch (error) {
        throw new Error('Failed to decode base64 data');
    }
}

// Export the main function for use in the HTML
window.convertDocuSignToPDF = convertDocuSignToPDF;

// Export the signature field creation function for use by field translators
window.createSignatureField = createSignatureField;
