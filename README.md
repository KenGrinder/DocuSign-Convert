## DocuSign Template to Adobe Fillable PDF Converter

This tool converts a DocuSign Template JSON export (including embedded base64 PDF(s) and tab coordinates) into a single merged PDF containing Adobe AcroForm fields positioned to match the DocuSign tabs.

*Mostly AI Slop*

## 🌐 Web Application

**Try it online**: [GitHub Pages Demo](https://kengrinder.github.io/DocuSign-Convert/)

The web application provides a user-friendly interface for converting DocuSign JSON files to PDFs directly in your browser. All processing happens client-side, ensuring your files never leave your device.

### Features
- **Privacy First**: All processing happens in your browser
- **No Server Costs**: Completely free hosting on GitHub Pages
- **Modern UI**: Beautiful, responsive interface with drag-and-drop support
- **Real-time Conversion**: Instant PDF generation and download
- **Customizable Options**: Header/footer masking, document exclusion, field styling, and more

## 🖥️ Local Usage

### Static Web Application

1. **Open the web app**:
   - Simply open `index.html` in your web browser
   - No installation or setup required

2. **Convert your files**:
   - Drag and drop your DocuSign JSON file
   - Configure conversion options (header masking, document exclusion, etc.)
   - Click "Convert to PDF" to generate and download the fillable PDF

### Features
- **No installation required** - Works in any modern browser
- **Privacy-first** - All processing happens in your browser
- **Customizable options** - Header/footer masking, document exclusion, field styling

## 🚀 GitHub Pages Deployment

This project is designed to work with GitHub Pages for free hosting:

### Setup Steps

1. **Enable GitHub Pages**:
   - Go to your repository settings
   - Navigate to "Pages" section
   - Select "Deploy from a branch"
   - Choose "main" branch and "/ (root)" folder

2. **Deploy automatically**:
   - The GitHub Actions workflow will automatically deploy the static version
   - Your site will be available at `https://kengrinder.github.io/DocuSign-Convert`

3. **Custom domain** (optional):
   - Add your domain to the `CNAME` file
   - Update the GitHub Actions workflow with your domain

### File Structure

```
├── index.html              # Main web page (GitHub Pages entry point)
├── js/
│   └── converter.js        # Client-side PDF conversion logic
├── .github/workflows/
│   └── deploy.yml          # GitHub Actions deployment
├── _headers                # Security headers
├── _redirects              # Redirect rules
└── README.md               # Documentation
```

## Supported Features

- **Tab Types**: Text fields, SignHere, InitialHere, DateSigned (currently converts to text fields)
- **Coordinates**: DocuSign uses top-left origin with pixel-like units; this tool converts to PDF user space using each page's size
- **Header/Footer Masking**: Automatically hide DocuSign envelope IDs and other unwanted content
- **Document Exclusion**: Skip specific documents during conversion
- **Multi-page Support**: Handle multiple documents and pages seamlessly

## Limitations

- **Field Types**: Currently only supports text and signature fields. AcroForm supports additional types (checkboxes, radio buttons, dropdowns, list boxes) that are not yet implemented
- **Advanced Features**: Conditional logic, formulas, and complex styling are not fully implemented
- **Client-side Processing**: Large files may take longer to process in the browser
- **Radio Groups**: DocuSign RadioGroup tabs are converted to text fields (not interactive radio buttons)

## 🛠️ Development

This is a pure static web application. To modify:

1. **Edit the web interface**: Modify `index.html`
2. **Update conversion logic**: Edit `js/converter.js`
3. **Test locally**: Open `index.html` in your browser
4. **Deploy**: Push changes to GitHub (automatic deployment)

## ⚖️ Legal Disclaimer

This tool is not affiliated with, endorsed by, or sponsored by DocuSign or Adobe. 
It processes user-exported JSON data to create standard PDF files. 
Users are responsible for ensuring they have the right to convert their documents.

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.
