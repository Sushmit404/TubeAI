# TubeAI - YouTube Learning Assistant

A Chrome extension that enhances your YouTube learning experience by providing AI-powered answers to anything you want from a youtube video. 


## Setup Instructions

### 1. Clone the Repository
```bash
git clone https://github.com/Sushmit404/TubeAI.git
cd TubeAI
```

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure API Keys
You need to add your OpenAI API key to use the AI features:

1. Get an API key from [OpenAI](https://platform.openai.com/api-keys)
2. Open `services/aiService.js`
3. Replace the empty string on line 4 with your API key:
   ```javascript
   this.openaiApiKey = 'your-api-key-here';
   ```
4. Also update `background.js` line 9:
   ```javascript
   const OPENAI_API_KEY = 'your-api-key-here';
   ```

### 4. Build the Extension
```bash
npm run build
```

### 5. Load in Chrome
1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked"
4. Select the project folder
5. The extension should now appear in your extensions list

## Usage

1. Navigate to any YouTube video
2. Pause the video when you want to learn more about a topic
3. The extension will automatically analyze the video content
4. Click the extension icon to see AI-generated explanations, quizzes, and learning paths
5. Use the chat feature to ask questions about the video content

## Project Structure

```
TubeAI/
├── background.js          # Background script for AI processing
├── contentScript.js       # Content script for YouTube integration
├── popup.html            # Extension popup interface
├── popup.js              # Popup functionality
├── manifest.json          # Extension manifest
├── services/
│   ├── aiService.js      # AI service with OpenAI integration
│   └── vectorService.js  # Vector search functionality
├── components/           # React components (if using)
├── scripts/             # Utility scripts
└── icons/              # Extension icons
```

## Development

### Building
```bash
npm run build
```

### Watching for Changes
```bash
npm run watch
```

## Security Notes

- Never commit API keys to version control
- The `.gitignore` file excludes sensitive files
- API keys should be stored in environment variables for production

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## Support

If you encounter any issues or have questions, please open an issue on GitHub. 
