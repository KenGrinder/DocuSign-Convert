/**
 * DocuSign Field Translation System
 * 
 * This module provides a comprehensive translation system for converting DocuSign field types
 * to PDF AcroForm fields. Each field type has its own translator function that handles
 * the specific conversion logic for that field type.
 * 
 * Based on DocuSign JSON Reference: DocuSign_JSON_Reference.md
 */

// Field type configuration and registry
const FIELD_TRANSLATORS = {
    // Text-based fields
    textTabs: {
        name: 'Text Fields',
        description: 'Single-line text input fields',
        enabled: true,
        translator: translateTextField
    },
    
    // Signature fields
    signHereTabs: {
        name: 'Signature Fields',
        description: 'Adobe Fill & Sign signature fields for full signatures',
        enabled: true,
        translator: translateSignatureField
    },
    
    initialHereTabs: {
        name: 'Initial Fields',
        description: 'Adobe Fill & Sign signature fields optimized for initials',
        enabled: true,
        translator: translateInitialsField
    },
    
    // Form controls
    checkboxTabs: {
        name: 'Checkbox Fields',
        description: 'Checkbox form controls',
        enabled: true,
        translator: translateCheckboxField
    },
    
    radioGroupTabs: {
        name: 'Radio Button Groups',
        description: 'Radio button groups with mutual exclusion',
        enabled: true,
        translator: translateRadioGroupField
    },
    
    listTabs: {
        name: 'Dropdown Lists',
        description: 'Dropdown/combo box selections',
        enabled: true,
        translator: translateListField
    },
    
    // Auto-populated fields
    fullNameTabs: {
        name: 'Full Name Fields',
        description: 'Auto-populated full name fields',
        enabled: true,
        translator: translateFullNameField
    },
    
    dateSignedTabs: {
        name: 'Date Signed Fields',
        description: 'Auto-populated date fields with signing date',
        enabled: true,
        translator: translateDateSignedField
    },
    
    companyTabs: {
        name: 'Company Fields',
        description: 'Auto-populated company name fields',
        enabled: true,
        translator: translateCompanyField
    },
    
    titleTabs: {
        name: 'Title Fields',
        description: 'Auto-populated job title fields',
        enabled: true,
        translator: translateTitleField
    },
    
    emailAddressTabs: {
        name: 'Email Address Fields',
        description: 'Auto-populated email address fields',
        enabled: true,
        translator: translateEmailField
    },
    
    numericalTabs: {
        name: 'Numerical Fields',
        description: 'Numeric input fields with validation',
        enabled: true,
        translator: translateNumericalField
    },
    
    signerAttachmentTabs: {
        name: 'File Attachment Fields',
        description: 'File attachment fields for document uploads',
        enabled: true,
        translator: translateSignerAttachmentField
    }
};

/**
 * Main field translation dispatcher
 * Routes DocuSign fields to their appropriate translators
 * 
 * @param {string} fieldType - The DocuSign field type (e.g., 'textTabs', 'signHereTabs')
 * @param {Object} fieldData - The DocuSign field data
 * @param {PDFDocument} pdfDoc - The PDF document
 * @param {PDFPage} page - The PDF page
 * @param {Object} options - Translation options
 * @returns {Promise<boolean>} - Success status
 */
async function translateField(fieldType, fieldData, pdfDoc, page, options = {}) {
    try {
        // Check if field type is supported and enabled
        const translatorConfig = FIELD_TRANSLATORS[fieldType];
        if (!translatorConfig) {
            console.warn(`Unsupported field type: ${fieldType}`);
            return false;
        }
        
        if (!translatorConfig.enabled) {
            console.log(`Field type ${fieldType} is disabled, skipping`);
            return false;
        }
        
        // Validate field data
        if (!validateFieldData(fieldData, fieldType)) {
            console.warn(`Invalid field data for ${fieldType}:`, fieldData);
            return false;
        }
        
        // Translate coordinates from DocuSign to PDF
        const pdfCoords = convertDocuSignCoordinates(fieldData, page);
        
        // Call the specific translator
        const result = await translatorConfig.translator(fieldData, pdfDoc, page, pdfCoords, options);
        
        if (result) {
            console.log(`✓ Translated ${translatorConfig.name}: ${fieldData.tabLabel || fieldData.name || 'unnamed'}`);
        }
        
        return result;
        
    } catch (error) {
        console.error(`Failed to translate ${fieldType} field:`, error);
        return false;
    }
}

/**
 * Validate field data structure
 * 
 * @param {Object} fieldData - The field data to validate
 * @param {string} fieldType - The field type
 * @returns {boolean} - Validation result
 */
function validateFieldData(fieldData, fieldType) {
    if (!fieldData || typeof fieldData !== 'object') {
        return false;
    }
    
    // Check required properties
    const requiredProps = ['pageNumber', 'xPosition', 'yPosition'];
    for (const prop of requiredProps) {
        if (fieldData[prop] === undefined || fieldData[prop] === null) {
            return false;
        }
    }
    
    // Type-specific validation
    switch (fieldType) {
        case 'textTabs':
            return true; // Text fields are very flexible
        
        case 'signHereTabs':
        case 'initialHereTabs':
            return fieldData.name || fieldData.tabLabel;
        
        case 'checkboxTabs':
            return true;
        
        case 'radioGroupTabs':
            return fieldData.groupName && fieldData.radios && Array.isArray(fieldData.radios);
        
        case 'listTabs':
            return fieldData.listItems && Array.isArray(fieldData.listItems);
        
        default:
            return true;
    }
}

/**
 * Convert DocuSign coordinates to PDF coordinates
 * DocuSign uses top-left origin, PDF uses bottom-left origin
 * 
 * @param {Object} fieldData - The DocuSign field data
 * @param {PDFPage} page - The PDF page
 * @returns {Object} - PDF coordinates {llx, lly, urx, ury}
 */
function convertDocuSignCoordinates(fieldData, page) {
    const x = parseFloat(fieldData.xPosition || 0);
    const y = parseFloat(fieldData.yPosition || 0);
    const width = parseFloat(fieldData.width || 0);
    const height = parseFloat(fieldData.height || 0);
    
    // Get page dimensions
    const pageSize = page.getSize();
    const pageHeight = pageSize.height;
    
    // Determine field type for appropriate minimum sizing
    const fieldType = fieldData.tabType || fieldData.type || 'text';
    let minWidth = 50;  // Default minimum width
    let minHeight = 15; // Default minimum height
    
    // Set appropriate minimum sizes based on field type
    if (fieldType.includes('checkbox')) {
        minWidth = 15;   // Checkboxes should be square-ish
        minHeight = 15;
    } else if (fieldType.includes('radio')) {
        minWidth = 15;   // Radio buttons should be square-ish
        minHeight = 15;
    } else if (fieldType.includes('signature') || fieldType.includes('initial')) {
        minWidth = 100;  // Signatures need more space
        minHeight = 30;
    } else if (fieldType.includes('list') || fieldType.includes('dropdown')) {
        minWidth = 80;   // Dropdowns need reasonable width
        minHeight = 20;
    }
    
    // Convert DocuSign (top-left origin) to PDF (bottom-left origin)
    const pdfX = x;
    const pdfY = pageHeight - (y + Math.max(height, minHeight)); // Use appropriate minimum height
    const pdfWidth = Math.max(width, minWidth); // Use appropriate minimum width
    const pdfHeight = Math.max(height, minHeight); // Use appropriate minimum height
    
    console.log(`Coordinate conversion for ${fieldType}:`, {
        original: { x, y, width, height },
        converted: { pdfX, pdfY, pdfWidth, pdfHeight },
        pageHeight: pageHeight
    });
    
    return {
        llx: pdfX,
        lly: pdfY,
        urx: pdfX + pdfWidth,
        ury: pdfY + pdfHeight
    };
}

// ============================================================================
// FIELD TRANSLATORS
// ============================================================================

/**
 * Translate DocuSign text fields to PDF text fields
 * 
 * @param {Object} fieldData - DocuSign field data
 * @param {PDFDocument} pdfDoc - PDF document
 * @param {PDFPage} page - PDF page
 * @param {Object} coords - PDF coordinates
 * @param {Object} options - Translation options
 * @returns {Promise<boolean>} - Success status
 */
async function translateTextField(fieldData, pdfDoc, page, coords, options) {
    try {
        const fieldName = generateFieldName(fieldData);
        const defaultValue = fieldData.value || options.defaultValue || '';
        
        // Debug coordinate information for text fields
        console.log(`Text field coordinates:`, {
            llx: coords.llx,
            lly: coords.lly,
            urx: coords.urx,
            ury: coords.ury,
            width: coords.urx - coords.llx,
            height: coords.ury - coords.lly,
            fieldName: fieldName
        });
        
        // Create proper PDF text form field using correct pdf-lib API
        const form = pdfDoc.getForm();
        const textField = form.createTextField(fieldName);
        
        // Set default value if provided
        if (defaultValue) {
            textField.setText(defaultValue);
        }
        
        // Add field to page using correct API
        textField.addToPage(page, {
            x: coords.llx,
            y: coords.lly,
            width: coords.urx - coords.llx,
            height: coords.ury - coords.lly
        });
        
        return true;
    } catch (error) {
        console.error('Failed to translate text field:', error);
        return false;
    }
}

/**
 * Translate DocuSign signature fields to PDF signature fields
 * 
 * @param {Object} fieldData - DocuSign field data
 * @param {PDFDocument} pdfDoc - PDF document
 * @param {PDFPage} page - PDF page
 * @param {Object} coords - PDF coordinates
 * @param {Object} options - Translation options
 * @returns {Promise<boolean>} - Success status
 */
async function translateSignatureField(fieldData, pdfDoc, page, coords, options) {
    try {
        const fieldName = generateFieldName(fieldData);
        
        // Use the optimized signature field creation
        await createOptimizedSignatureField(pdfDoc, page, fieldName, coords, 'signature');
        
        return true;
    } catch (error) {
        console.error('Failed to translate signature field:', error);
        return false;
    }
}

/**
 * Translate DocuSign initial fields to PDF signature fields (optimized for initials)
 * 
 * @param {Object} fieldData - DocuSign field data
 * @param {PDFDocument} pdfDoc - PDF document
 * @param {PDFPage} page - PDF page
 * @param {Object} coords - PDF coordinates
 * @param {Object} options - Translation options
 * @returns {Promise<boolean>} - Success status
 */
async function translateInitialsField(fieldData, pdfDoc, page, coords, options) {
    try {
        const fieldName = generateFieldName(fieldData);
        
        // Use the optimized signature field creation with initials type
        await createOptimizedSignatureField(pdfDoc, page, fieldName, coords, 'initials');
        
        return true;
    } catch (error) {
        console.error('Failed to translate initials field:', error);
        return false;
    }
}

/**
 * Translate DocuSign checkbox fields to PDF checkbox fields
 * 
 * @param {Object} fieldData - DocuSign field data
 * @param {PDFDocument} pdfDoc - PDF document
 * @param {PDFPage} page - PDF page
 * @param {Object} coords - PDF coordinates
 * @param {Object} options - Translation options
 * @returns {Promise<boolean>} - Success status
 */
async function translateCheckboxField(fieldData, pdfDoc, page, coords, options) {
    try {
        const fieldName = generateFieldName(fieldData);
        const isChecked = fieldData.selected === true || fieldData.selected === 'true';
        
        // Debug coordinate information
        console.log(`Checkbox coordinates:`, {
            llx: coords.llx,
            lly: coords.lly,
            urx: coords.urx,
            ury: coords.ury,
            width: coords.urx - coords.llx,
            height: coords.ury - coords.lly,
            fieldName: fieldName
        });
        
        // Use coordinates as provided (minimum sizing handled in coordinate conversion)
        const width = coords.urx - coords.llx;
        const height = coords.ury - coords.lly;
        
        // Create proper PDF checkbox form field using correct pdf-lib API
        const form = pdfDoc.getForm();
        const checkbox = form.createCheckBox(fieldName);
        
        // Set checked state if specified
        if (isChecked) {
            checkbox.check();
        }
        
        // Add field to page using correct API with ensured minimum size
        checkbox.addToPage(page, {
            x: coords.llx,
            y: coords.lly,
            width: width,
            height: height,
            borderWidth: 1,
            borderColor: PDFLib.rgb(0, 0, 0)
        });
        
        console.log(`✓ Created checkbox: ${fieldName} at (${coords.llx}, ${coords.lly}) size ${width}x${height}`);
        
        return true;
    } catch (error) {
        console.error('Failed to translate checkbox field:', error);
        return false;
    }
}

/**
 * Translate DocuSign radio group fields to PDF radio button groups
 * 
 * @param {Object} fieldData - DocuSign field data
 * @param {PDFDocument} pdfDoc - PDF document
 * @param {PDFPage} page - PDF page
 * @param {Object} coords - PDF coordinates
 * @param {Object} options - Translation options
 * @returns {Promise<boolean>} - Success status
 */
async function translateRadioGroupField(fieldData, pdfDoc, page, coords, options) {
    try {
        const groupName = fieldData.groupName;
        const radios = fieldData.radios || [];
        
        if (radios.length === 0) {
            console.warn('Radio group has no radio buttons');
            return false;
        }
        
        // Create radio group using correct pdf-lib API
        console.log('Creating radio group using correct pdf-lib API');
        
        // Create radio group
        const form = pdfDoc.getForm();
        const radioGroup = form.createRadioGroup(groupName);
        
        // Add each radio button option using correct API
        for (let i = 0; i < radios.length; i++) {
            const radio = radios[i];
            const radioCoords = convertDocuSignCoordinates(radio, page);
            
            // Ensure value is a string
            let radioValue = radio.value || radio.text || `option_${i}`;
            if (typeof radioValue !== 'string') {
                radioValue = String(radioValue);
            }
            if (!radioValue || radioValue === 'undefined' || radioValue === 'null') {
                radioValue = `option_${i}`;
            }
            
            // Add radio option to page using correct API
            radioGroup.addOptionToPage(radioValue, page, {
                x: radioCoords.llx,
                y: radioCoords.lly,
                width: radioCoords.urx - radioCoords.llx,
                height: radioCoords.ury - radioCoords.lly,
                borderWidth: 1,
                borderColor: PDFLib.rgb(0, 0, 0)
            });
            
            // Set selected state if specified
            if (radio.selected === true || radio.selected === 'true') {
                radioGroup.select(radioValue);
            }
            
            console.log(`✓ Added radio option: ${radioValue}`);
        }
        
        return true;
    } catch (error) {
        console.error('Failed to translate radio group field:', error);
        return false;
    }
}

/**
 * Translate DocuSign list fields to PDF dropdown fields
 * 
 * @param {Object} fieldData - DocuSign field data
 * @param {PDFDocument} pdfDoc - PDF document
 * @param {PDFPage} page - PDF page
 * @param {Object} coords - PDF coordinates
 * @param {Object} options - Translation options
 * @returns {Promise<boolean>} - Success status
 */
async function translateListField(fieldData, pdfDoc, page, coords, options) {
    try {
        const fieldName = generateFieldName(fieldData);
        const listItems = fieldData.listItems || [];
        
        if (listItems.length === 0) {
            console.warn('List field has no items');
            return false;
        }
        
        // Create dropdown field using correct pdf-lib API
        const form = pdfDoc.getForm();
        const dropdown = form.createDropdown(fieldName);
        
        // Add options using correct API
        for (const item of listItems) {
            dropdown.addOptions([{ label: item.text, value: item.value }]);
            
            if (item.selected === true || item.selected === 'true') {
                dropdown.select(item.value);
            }
        }
        
        // Set default value if specified
        if (fieldData.value) {
            dropdown.select(fieldData.value);
        }
        
        // Add field to page using correct API
        dropdown.addToPage(page, {
            x: coords.llx,
            y: coords.lly,
            width: coords.urx - coords.llx,
            height: coords.ury - coords.lly
        });
        
        return true;
    } catch (error) {
        console.error('Failed to translate list field:', error);
        return false;
    }
}

/**
 * Translate DocuSign full name fields to PDF text fields (auto-populated)
 * 
 * @param {Object} fieldData - DocuSign field data
 * @param {PDFDocument} pdfDoc - PDF document
 * @param {PDFPage} page - PDF page
 * @param {Object} coords - PDF coordinates
 * @param {Object} options - Translation options
 * @returns {Promise<boolean>} - Success status
 */
async function translateFullNameField(fieldData, pdfDoc, page, coords, options) {
    try {
        const fieldName = generateFieldName(fieldData);
        const defaultValue = fieldData.value || '[FULL NAME]';
        
        // Create proper PDF text form field using correct pdf-lib API
        const form = pdfDoc.getForm();
        const textField = form.createTextField(fieldName);
        
        // Set default value/placeholder
        textField.setText(defaultValue);
        
        // Add field to page using correct API
        textField.addToPage(page, {
            x: coords.llx,
            y: coords.lly,
            width: coords.urx - coords.llx,
            height: coords.ury - coords.lly
        });
        
        return true;
    } catch (error) {
        console.error('Failed to translate full name field:', error);
        return false;
    }
}

/**
 * Translate DocuSign date signed fields to PDF text fields
 * 
 * @param {Object} fieldData - DocuSign field data
 * @param {PDFDocument} pdfDoc - PDF document
 * @param {PDFPage} page - PDF page
 * @param {Object} coords - PDF coordinates
 * @param {Object} options - Translation options
 * @returns {Promise<boolean>} - Success status
 */
async function translateDateSignedField(fieldData, pdfDoc, page, coords, options) {
    try {
        const fieldName = generateFieldName(fieldData);
        const currentDate = new Date().toLocaleDateString();
        
        // Create proper PDF text form field using correct pdf-lib API
        const form = pdfDoc.getForm();
        const textField = form.createTextField(fieldName);
        
        // Set current date as default value
        textField.setText(currentDate);
        
        // Add field to page using correct API
        textField.addToPage(page, {
            x: coords.llx,
            y: coords.lly,
            width: coords.urx - coords.llx,
            height: coords.ury - coords.lly
        });
        
        return true;
    } catch (error) {
        console.error('Failed to translate date signed field:', error);
        return false;
    }
}

/**
 * Translate DocuSign company fields to PDF text fields (auto-populated)
 * 
 * @param {Object} fieldData - DocuSign field data
 * @param {PDFDocument} pdfDoc - PDF document
 * @param {PDFPage} page - PDF page
 * @param {Object} coords - PDF coordinates
 * @param {Object} options - Translation options
 * @returns {Promise<boolean>} - Success status
 */
async function translateCompanyField(fieldData, pdfDoc, page, coords, options) {
    try {
        const fieldName = generateFieldName(fieldData);
        const defaultValue = fieldData.value || '[COMPANY]';
        
        // Create proper PDF text form field using correct pdf-lib API
        const form = pdfDoc.getForm();
        const textField = form.createTextField(fieldName);
        
        // Set default value/placeholder
        textField.setText(defaultValue);
        
        // Add field to page using correct API
        textField.addToPage(page, {
            x: coords.llx,
            y: coords.lly,
            width: coords.urx - coords.llx,
            height: coords.ury - coords.lly
        });
        
        return true;
    } catch (error) {
        console.error('Failed to translate company field:', error);
        return false;
    }
}

/**
 * Translate DocuSign title fields to PDF text fields (auto-populated)
 * 
 * @param {Object} fieldData - DocuSign field data
 * @param {PDFDocument} pdfDoc - PDF document
 * @param {PDFPage} page - PDF page
 * @param {Object} coords - PDF coordinates
 * @param {Object} options - Translation options
 * @returns {Promise<boolean>} - Success status
 */
async function translateTitleField(fieldData, pdfDoc, page, coords, options) {
    try {
        const fieldName = generateFieldName(fieldData);
        const defaultValue = fieldData.value || '[TITLE]';
        
        // Create proper PDF text form field using correct pdf-lib API
        const form = pdfDoc.getForm();
        const textField = form.createTextField(fieldName);
        
        // Set default value/placeholder
        textField.setText(defaultValue);
        
        // Add field to page using correct API
        textField.addToPage(page, {
            x: coords.llx,
            y: coords.lly,
            width: coords.urx - coords.llx,
            height: coords.ury - coords.lly
        });
        
        return true;
    } catch (error) {
        console.error('Failed to translate title field:', error);
        return false;
    }
}

/**
 * Translate DocuSign email fields to PDF text fields (auto-populated)
 * 
 * @param {Object} fieldData - DocuSign field data
 * @param {PDFDocument} pdfDoc - PDF document
 * @param {PDFPage} page - PDF page
 * @param {Object} coords - PDF coordinates
 * @param {Object} options - Translation options
 * @returns {Promise<boolean>} - Success status
 */
async function translateEmailField(fieldData, pdfDoc, page, coords, options) {
    try {
        const fieldName = generateFieldName(fieldData);
        const defaultValue = fieldData.value || '[EMAIL]';
        
        // Create proper PDF text form field using correct pdf-lib API
        const form = pdfDoc.getForm();
        const textField = form.createTextField(fieldName);
        
        // Set default value/placeholder
        textField.setText(defaultValue);
        
        // Add field to page using correct API
        textField.addToPage(page, {
            x: coords.llx,
            y: coords.lly,
            width: coords.urx - coords.llx,
            height: coords.ury - coords.lly
        });
        
        return true;
    } catch (error) {
        console.error('Failed to translate email field:', error);
        return false;
    }
}

/**
 * Translate DocuSign numerical fields to PDF text fields with numeric validation
 * 
 * @param {Object} fieldData - DocuSign field data
 * @param {PDFDocument} pdfDoc - PDF document
 * @param {PDFPage} page - PDF page
 * @param {Object} coords - PDF coordinates
 * @param {Object} options - Translation options
 * @returns {Promise<boolean>} - Success status
 */
async function translateNumericalField(fieldData, pdfDoc, page, coords, options) {
    try {
        const fieldName = generateFieldName(fieldData);
        const defaultValue = fieldData.value || '[NUMBER]';
        
        // Create proper PDF text form field using correct pdf-lib API
        const form = pdfDoc.getForm();
        const textField = form.createTextField(fieldName);
        
        // Set default value/placeholder
        textField.setText(defaultValue);
        
        // Add field to page using correct API
        textField.addToPage(page, {
            x: coords.llx,
            y: coords.lly,
            width: coords.urx - coords.llx,
            height: coords.ury - coords.lly
        });
        
        return true;
    } catch (error) {
        console.error('Failed to translate numerical field:', error);
        return false;
    }
}

/**
 * Translate DocuSign signer attachment fields to PDF text fields
 * 
 * Note: PDF-lib doesn't have native file attachment field support like DocuSign.
 * This creates a text field that can be used for file names or descriptions.
 * 
 * @param {Object} fieldData - DocuSign field data
 * @param {PDFDocument} pdfDoc - PDF document
 * @param {PDFPage} page - PDF page
 * @param {Object} coords - PDF coordinates
 * @param {Object} options - Translation options
 * @returns {Promise<boolean>} - Success status
 */
async function translateSignerAttachmentField(fieldData, pdfDoc, page, coords, options) {
    try {
        const fieldName = generateFieldName(fieldData);
        const attachmentName = fieldData.tabLabel || fieldData.name || 'Attachment';
        
        // Determine appropriate placeholder text based on the field name
        let placeholderText = '';
        if (attachmentName.toLowerCase().includes('lox') || 
            attachmentName.toLowerCase().includes('upload') ||
            attachmentName.toLowerCase().includes('loe') ||
            attachmentName.toLowerCase().includes('cel') ||
            attachmentName.toLowerCase().includes('udn')) {
            placeholderText = '[File Name/Description]';
        } else {
            placeholderText = '[Attachment File Name]';
        }
        
        // Create a text field for file attachment information
        const form = pdfDoc.getForm();
        const textField = form.createTextField(fieldName);
        
        // Set placeholder text
        textField.setText(placeholderText);
        
        // Add field to page with appropriate styling
        textField.addToPage(page, {
            x: coords.llx,
            y: coords.lly,
            width: coords.urx - coords.llx,
            height: coords.ury - coords.lly
        });
        
        console.log(`✓ Created attachment text field: ${attachmentName} -> ${placeholderText}`);
        return true;
    } catch (error) {
        console.error('Failed to translate signer attachment field:', error);
        return false;
    }
}

// ============================================================================
// FIELD CREATION FUNCTIONS
// ============================================================================

/**
 * Create optimized electronic signature field
 * 
 * This function creates a proper electronic signature field that works with Adobe's
 * "Fill & Sign" feature, allowing users to draw, type, or upload signatures.
 * 
 * @param {PDFDocument} pdfDoc - The PDF document
 * @param {PDFPage} page - The page to add the field to
 * @param {string} name - The field name
 * @param {Object} rect - The field rectangle
 * @param {string} fieldType - Type of field ('signature' or 'initials')
 * @returns {Promise<boolean>} - Success status
 */
async function createOptimizedSignatureField(pdfDoc, page, name, rect, fieldType = 'signature') {
    try {
        const isInitials = fieldType === 'initials';
        const fieldTypeLabel = isInitials ? 'initials' : 'signature';
        console.log(`Creating optimized electronic ${fieldTypeLabel} field: ${name}`);
        
        // STEP 1: Clean and validate the field name
        let cleanName = name;
        if (!cleanName || typeof cleanName !== 'string') {
            cleanName = `${fieldTypeLabel}_${Date.now()}`;
        }
        cleanName = cleanName.replace(/[^a-zA-Z0-9_-]/g, '_');
        
        // Ensure uniqueness by adding timestamp and random string
        const timestamp = Date.now();
        const random = Math.random().toString(36).substr(2, 5);
        cleanName = `${cleanName}_${timestamp}_${random}`.substring(0, 60);
        
        // STEP 2: Calculate field dimensions based on type
        const minWidth = isInitials ? 100 : 150;   // Initials: 100pts, Signatures: 150pts
        const minHeight = isInitials ? 25 : 40;    // Initials: 25pts, Signatures: 40pts
        const width = Math.max(rect.urx - rect.llx, minWidth);
        const height = Math.max(rect.ury - rect.lly, minHeight);
        
        // STEP 3: Create field rectangle array (used in multiple places)
        const fieldRect = pdfDoc.context.obj([
            PDFLib.PDFNumber.of(rect.llx),
            PDFLib.PDFNumber.of(rect.lly),
            PDFLib.PDFNumber.of(rect.llx + width),
            PDFLib.PDFNumber.of(rect.lly + height)
        ]);
        
        // STEP 4: Create field dictionary with proper electronic signature properties
        const fieldDict = pdfDoc.context.obj({
            Type: 'Annot',
            Subtype: 'Widget',
            Rect: fieldRect,
            FT: 'Sig',                    // Field type: Signature
            T: cleanName,                 // Field name
            F: 4,                         // Field flags: Print
            Ff: 0,                        // Field flags: Allow electronic signatures (no digital certificate required)
            V: pdfDoc.context.obj({}),    // Field value (empty initially)
            AS: pdfDoc.context.obj({}),   // Appearance state (empty initially)
            MK: pdfDoc.context.obj({      // Appearance characteristics
                BC: [0, 0, 0],            // Border color: black
                BG: [1, 1, 1]             // Background color: white
            }),
            DA: `/Helv 12 Tf 0 0 0 rg`,  // Default appearance: Helvetica 12pt black
            BS: pdfDoc.context.obj({      // Border style
                Type: 'Border',
                W: 1,                     // Border width: 1 point
                S: 'S'                    // Border style: Solid
            })
        });
        
        // STEP 5: Add field to form
        const form = pdfDoc.getForm();
        const formDict = form.dict;
        
        // Get or create Fields array
        let fieldsArray = formDict.get('Fields');
        if (!fieldsArray) {
            fieldsArray = pdfDoc.context.obj([]);
            formDict.set('Fields', fieldsArray);
        }
        
        // Add field reference to Fields array
        fieldsArray.push(fieldDict);
        
        // STEP 6: Add widget annotation to page
        const pageDict = page.node;
        let annotsArray = pageDict.get('Annots');
        if (!annotsArray) {
            annotsArray = pdfDoc.context.obj([]);
            pageDict.set('Annots', annotsArray);
        }
        
        // Add widget annotation
        annotsArray.push(fieldDict);
        
        // STEP 7: Update field appearances to ensure proper rendering
        try {
            form.updateFieldAppearances();
            console.log(`✓ Updated field appearances for ${fieldTypeLabel} field`);
        } catch (error) {
            console.warn(`Failed to update field appearances for ${fieldTypeLabel} field:`, error);
        }
        
        console.log(`✓ Successfully created optimized electronic ${fieldTypeLabel} field: ${cleanName}`);
        return true;
        
    } catch (error) {
        console.error(`Failed to create optimized ${fieldType} field "${name}":`, error);
        return false;
    }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generate a valid PDF field name from DocuSign field data
 * 
 * @param {Object} fieldData - DocuSign field data
 * @returns {string} - Valid PDF field name
 */
function generateFieldName(fieldData) {
    let name = fieldData.name || fieldData.tabLabel || `Field_${Date.now()}`;
    
    // Clean the name for PDF compatibility
    name = name.replace(/[^a-zA-Z0-9_-]/g, '_');
    
    // Ensure uniqueness by adding timestamp and random string
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 5);
    const uniqueName = `${name}_${timestamp}_${random}`;
    
    // Truncate to PDF field name limits while preserving uniqueness
    return uniqueName.substring(0, 60);
}

/**
 * Convert DocuSign font size to PDF font size
 * 
 * @param {string} docuSignSize - DocuSign font size (e.g., 'size9', 'size12')
 * @returns {number} - PDF font size in points
 */
function convertFontSize(docuSignSize) {
    if (!docuSignSize || typeof docuSignSize !== 'string') {
        return 12; // Default font size
    }
    
    const sizeMatch = docuSignSize.match(/size(\d+)/i);
    if (sizeMatch) {
        return parseInt(sizeMatch[1]);
    }
    
    return 12; // Default font size
}

/**
 * Convert DocuSign font color to PDF color
 * 
 * @param {string} docuSignColor - DocuSign font color (e.g., 'black', 'red')
 * @returns {Object} - PDF color object
 */
function convertFontColor(docuSignColor) {
    if (!docuSignColor || typeof docuSignColor !== 'string') {
        return PDFLib.rgb(0, 0, 0); // Default to black
    }
    
    const color = docuSignColor.toLowerCase();
    switch (color) {
        case 'black':
            return PDFLib.rgb(0, 0, 0);
        case 'red':
            return PDFLib.rgb(1, 0, 0);
        case 'green':
            return PDFLib.rgb(0, 1, 0);
        case 'blue':
            return PDFLib.rgb(0, 0, 1);
        default:
            return PDFLib.rgb(0, 0, 0); // Default to black
    }
}

// ============================================================================
// FIELD TYPE CONTROL FUNCTIONS
// ============================================================================

/**
 * Set the enabled/disabled state of a specific field type
 * 
 * @param {string} fieldType - The field type to modify (e.g., 'textTabs', 'signHereTabs')
 * @param {boolean} enabled - Whether to enable or disable the field type
 * @returns {boolean} - Success status
 */
function setFieldTypeEnabled(fieldType, enabled) {
    try {
        if (!FIELD_TRANSLATORS[fieldType]) {
            console.warn(`Unknown field type: ${fieldType}`);
            return false;
        }
        
        FIELD_TRANSLATORS[fieldType].enabled = enabled;
        console.log(`Field type ${fieldType} ${enabled ? 'enabled' : 'disabled'}`);
        return true;
    } catch (error) {
        console.error(`Failed to set field type ${fieldType} enabled state:`, error);
        return false;
    }
}

/**
 * Get the configuration for a specific field type
 * 
 * @param {string} fieldType - The field type to get config for
 * @returns {Object|null} - Field type configuration or null if not found
 */
function getFieldTypeConfig(fieldType) {
    try {
        if (!FIELD_TRANSLATORS[fieldType]) {
            console.warn(`Unknown field type: ${fieldType}`);
            return null;
        }
        
        return {
            ...FIELD_TRANSLATORS[fieldType],
            fieldType: fieldType
        };
    } catch (error) {
        console.error(`Failed to get field type config for ${fieldType}:`, error);
        return null;
    }
}

/**
 * Get all field type configurations
 * 
 * @returns {Object} - All field type configurations
 */
function getAllFieldTypeConfigs() {
    try {
        const configs = {};
        for (const [fieldType, config] of Object.entries(FIELD_TRANSLATORS)) {
            configs[fieldType] = {
                ...config,
                fieldType: fieldType
            };
        }
        return configs;
    } catch (error) {
        console.error('Failed to get all field type configs:', error);
        return {};
    }
}

/**
 * Reset all field types to enabled state
 * 
 * @returns {boolean} - Success status
 */
function resetAllFieldTypes() {
    try {
        for (const fieldType of Object.keys(FIELD_TRANSLATORS)) {
            FIELD_TRANSLATORS[fieldType].enabled = true;
        }
        console.log('All field types reset to enabled');
        return true;
    } catch (error) {
        console.error('Failed to reset field types:', error);
        return false;
    }
}

/**
 * Get the current enabled/disabled state of all field types
 * 
 * @returns {Object} - Object with field types as keys and enabled states as values
 */
function getFieldTypeStates() {
    try {
        const states = {};
        for (const [fieldType, config] of Object.entries(FIELD_TRANSLATORS)) {
            states[fieldType] = config.enabled;
        }
        return states;
    } catch (error) {
        console.error('Failed to get field type states:', error);
        return {};
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

// Make functions available globally for use in HTML
if (typeof window !== 'undefined') {
    window.setFieldTypeEnabled = setFieldTypeEnabled;
    window.getFieldTypeConfig = getFieldTypeConfig;
    window.getAllFieldTypeConfigs = getAllFieldTypeConfigs;
    window.resetAllFieldTypes = resetAllFieldTypes;
    window.getFieldTypeStates = getFieldTypeStates;
    window.translateField = translateField;
}

// Export the field translation system
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        translateField,
        getFieldTypeConfig,
        setFieldTypeEnabled,
        getAllFieldTypeConfigs,
        resetAllFieldTypes,
        getFieldTypeStates,
        FIELD_TRANSLATORS
    };
}
