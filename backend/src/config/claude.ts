import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
});

interface SessionData {
    videoType: string;
    duration: string;
    locationFlow: string;
    targetVibe?: string;
    equipment?: string;
    keyMoments?: string;
    additionalDetails?: string;
}

export async function generateShotList(sessionData: SessionData) {
    const prompt = 
    `You are a professional video planning assistant. Create a detailed shot list for a vlog
        Video Details:
        - Type: ${sessionData.videoType}
        - Duration: ${sessionData.duration}
        - Location Flow: ${sessionData.locationFlow}
        ${sessionData.targetVibe ? `- Target Vibe: ${sessionData.targetVibe}` : ''}
        ${sessionData.equipment ? `- Equipment: ${sessionData.equipment}` : ''}
        ${sessionData.keyMoments ? `- Key Moments: ${sessionData.keyMoments}` : ''}
        ${sessionData.additionalDetails ? `- Additional Details: ${sessionData.additionalDetails}` : ''}
    Generate a comprehensive shot list. Return ONLY valid JSON (no markdown, no explanation) in this exact format:
    [
        {
            "shotNumber": 1,
            "location": "Bedroom",
            "title": "Alarm going off",
            "description": "Close-up of phone alarm, hand reaching to turn it off",
            "duration": "5 seconds",
            "shotType": "Close-up",
            "cameraMovement": "Static",
            "equipment": "iPhone handheld",
            "tips": "Use natural window light"   
        }
    ]
    Make the shot list realistic, organized by location flow, and match the requested duration.`;
    const response = await anthropic.messages.create({
        model: "claude-3-7-sonnet-20250219",
        max_tokens: 4096,
        messages: [
            {
                role: 'user',
                content: prompt
            }
        ]
    });
    const textContent = (response.content[0] as any).text;
    if(!textContent){
        throw new Error('No response from Claude API');
    }
    const shots = JSON.parse(textContent);
    if(!Array.isArray(shots)){
        throw new Error('Invalid response format: expected array of shots');
    }
    return shots;
}



//generateShotList()

//generateQuestions()

//replanShots()
