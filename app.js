document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('file-input');
    const btnAttach = document.getElementById('btn-attach');
    const inputPreviewWrapper = document.getElementById('input-preview-wrapper');
    const inputPreview = document.getElementById('input-preview');
    const btnRemovePreview = document.getElementById('btn-remove-preview');
    const textInput = document.getElementById('text-input');
    const btnSend = document.getElementById('btn-send');
    const chatHistory = document.getElementById('chat-history');

    let currentImageData = null;
    const GEMINI_API_KEY = "AIzaSyB4iYe3NNQjf2qAhxmfOJSMAaC8DTTM0xc"; // User provided API Key

    // File handling
    btnAttach.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', function () {
        handleFiles(this.files);
    });

    // Support Drag and Drop anywhere on window
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', e => {
        e.preventDefault();
        if (e.dataTransfer.files.length) {
            handleFiles(e.dataTransfer.files);
        }
    });

    function handleFiles(files) {
        if (files.length > 0) {
            const file = files[0];
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.readAsDataURL(file);
                reader.onload = () => {
                    currentImageData = reader.result;
                    inputPreview.src = currentImageData;
                    inputPreviewWrapper.classList.remove('hidden');
                    textInput.placeholder = "Image selected. Click send to analyze.";
                    btnSend.disabled = false;
                };
            } else {
                alert("Please upload an image file.");
            }
        }
    }

    btnRemovePreview.addEventListener('click', clearInput);

    function clearInput() {
        currentImageData = null;
        fileInput.value = "";
        inputPreviewWrapper.classList.add('hidden');
        textInput.placeholder = "Upload an image to start analysis...";
        btnSend.disabled = true;
    }

    // Chat Flow
    btnSend.addEventListener('click', async () => {
        if (!currentImageData) return;

        // 1. Add User Message
        addUserMessage(currentImageData);
        const imageToAnalyze = currentImageData; // save reference for analysis
        clearInput();
        scrollToBottom();

        // 2. Add AI Typing Indicator
        const typingId = addAITypingIndicator();
        scrollToBottom();

        // 3. Call Gemini API
        try {
            const analysisData = await callGeminiAPI(imageToAnalyze);

            // Remove typing indicator
            const typingEl = document.getElementById(typingId);
            if (typingEl) typingEl.remove();

            // 4. Append Real Results
            addAIResults(analysisData);
            scrollToBottom();

        } catch (error) {
            console.error("API Error:", error);
            const typingEl = document.getElementById(typingId);
            if (typingEl) typingEl.remove();

            addAIErrorMessage("I encountered an error analyzing that image. Please ensure you are connected to the internet and try again. Details: " + error.message);
            scrollToBottom();
        }
    });

    async function callGeminiAPI(base64Image) {
        const base64Data = base64Image.split(',')[1];

        // Construct the prompt demanding JSON output
        const promptText = `
        You are BoviScan, an expert AI cattle diagnostics assistant.
        Analyze the provided image. If the image DOES NOT contain cattle, return EXACTLY this JSON object:
        {
            "breed": "No cattle detected",
            "confidence": 0,
            "yield": 0,
            "yield_insight": "N/A",
            "health_status": "N/A",
            "risks": []
        }

        If the image DOES contain cattle, return a strictly formatted JSON object with the following structure:
        {
            "breed": "Name of the cattle breed identified (e.g., Gir, Holstein, Sahiwal, etc.)",
            "confidence": The confidence percentage as an integer between 50 and 99,
            "yield": The estimated milk yield in liters per day as an integer,
            "yield_insight": "A short 1 sentence insight about this yield.",
            "health_status": "Generally Healthy" OR "Attention Required",
            "risks": [
                {
                    "name": "Name of disease/risk (e.g., Mastitis, Lameness)",
                    "level": "Low" OR "Moderate" OR "High",
                    "safe": boolean (true if Low risk, false otherwise)
                },
                ... (Provide exactly 2 specific risks, one safe, one moderate/high if possible, else random realistic ones)
            ]
        }
        Return ONLY valid JSON.
        `;

        const requestBody = {
            contents: [
                {
                    parts: [
                        { text: promptText },
                        {
                            inline_data: {
                                mime_type: "image/jpeg",
                                data: base64Data
                            }
                        }
                    ]
                }
            ],
            generationConfig: {
                temperature: 0.2,
                topK: 32,
                topP: 1,
                maxOutputTokens: 1024,
            }
        };

        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        let textResponse = data.candidates[0].content.parts[0].text;

        // Sometimes the AI might respond with conversational text before/after the JSON
        // Find the first '{' and the last '}' to extract only the JSON object
        const firstBracket = textResponse.indexOf('{');
        const lastBracket = textResponse.lastIndexOf('}');

        if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
            textResponse = textResponse.substring(firstBracket, lastBracket + 1);
        }

        // Clean markdown JSON formatting if present just in case
        let jsonStr = textResponse.replace(/```json\n?|\n?```/g, '').trim();

        // Strip structural newlines and tabs to make the string safe to parse, 
        // avoiding invalid escaping of structural JSON characters.
        jsonStr = jsonStr.replace(/\n/g, "").replace(/\r/g, "").replace(/\t/g, "");

        try {
            return JSON.parse(jsonStr);
        } catch (e) {
            console.error("Failed to parse string:", jsonStr);
            console.error("Original text response:", textResponse);
            console.error(e);
            throw new Error(`The AI returned a malformed response. Raw output: ${jsonStr.substring(0, 50)}... Please try sending the image again.`);
        }
    }

    function addUserMessage(imgData) {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message user-message';
        msgDiv.innerHTML = `
            <div class="avatar"><i class="fa-solid fa-user"></i></div>
            <div class="message-content">
                <img src="${imgData}" class="uploaded-image-display" alt="Cattle to analyze">
                <p>Please analyze this image.</p>
            </div>
        `;
        chatHistory.appendChild(msgDiv);
    }

    function addAITypingIndicator() {
        const id = 'typing-' + Date.now();
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message ai-message';
        msgDiv.id = id;
        msgDiv.innerHTML = `
            <div class="avatar"><i class="fa-solid fa-robot"></i></div>
            <div class="message-content">
                <div class="typing-indicator">
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                    <div class="typing-dot"></div>
                </div>
            </div>
        `;
        chatHistory.appendChild(msgDiv);
        return id;
    }

    function addAIErrorMessage(errorMsg) {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'message ai-message';
        msgDiv.innerHTML = `
            <div class="avatar"><i class="fa-solid fa-robot"></i></div>
            <div class="message-content" style="border-color: var(--danger);">
                <p style="color: var(--danger);"><i class="fa-solid fa-triangle-exclamation"></i> ${errorMsg}</p>
            </div>
        `;
        chatHistory.appendChild(msgDiv);
    }

    function addAIResults(data) {
        const { breed, confidence, yield: yieldAmount, yield_insight, health_status, risks } = data;

        const healthConfig = health_status === "Attention Required" ?
            { color: "var(--danger)", bg: "rgba(239, 68, 68, 0.15)" } :
            { color: "var(--success)", bg: "rgba(16, 185, 129, 0.15)" };

        const msgDiv = document.createElement('div');
        msgDiv.className = 'message ai-message';

        let risksHtml = risks.map(r => {
            const icon = r.safe ? "fa-circle-check" : "fa-triangle-exclamation";
            const colorClass = r.safe ? "safe" : (r.level === "High" ? "danger" : "warning");
            return `<li><i class="fa-solid ${icon} ${colorClass}"></i> ${r.name} (${r.level})</li>`;
        }).join('');

        msgDiv.innerHTML = `
            <div class="avatar"><i class="fa-solid fa-robot"></i></div>
            <div class="message-content" style="width: 100%;">
                <p>I have analyzed the image using the Gemini Vision Engine. Here is the diagnostic report:</p>
                
                <div class="cards-grid">
                    <!-- Breed -->
                    <div class="glass-panel-card breed-card">
                        <div class="card-icon"><i class="fa-solid fa-dna"></i></div>
                        <div class="card-content" style="width: 100%;">
                            <h3>Breed Identification</h3>
                            <h4 class="highlight-text">${breed}</h4>
                            <div class="confidence-bar">
                                <div class="fill" style="width: ${confidence}%;"></div>
                            </div>
                            <span class="confidence-text">${confidence}% Match Confidence</span>
                        </div>
                    </div>

                    <!-- Yield -->
                    <div class="glass-panel-card yield-card">
                        <div class="card-icon"><i class="fa-solid fa-glass-water"></i></div>
                        <div class="card-content">
                            <h3>Est. Milk Yield</h3>
                            <div class="metric-display">
                                <span class="metric-value">${yieldAmount}</span>
                                <span class="metric-unit">Liters/day</span>
                            </div>
                            <p class="insight">${yield_insight}</p>
                        </div>
                    </div>

                    <!-- Health -->
                    <div class="glass-panel-card health-card">
                        <div class="card-icon"><i class="fa-solid fa-notes-medical"></i></div>
                        <div class="card-content">
                            <h3>Health Assessment</h3>
                            <div class="statusbadge" style="color: ${healthConfig.color}; background: ${healthConfig.bg}; border: 1px solid ${healthConfig.color};">${health_status}</div>
                            <ul class="risk-list">
                                ${risksHtml}
                            </ul>
                        </div>
                    </div>
                </div>
            </div>
        `;

        chatHistory.appendChild(msgDiv);
    }

    function scrollToBottom() {
        chatHistory.scrollTo({
            top: chatHistory.scrollHeight,
            behavior: 'smooth'
        });
    }
});
