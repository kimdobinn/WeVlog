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

interface QAContext {
    question: string;
    answer: string;
}

export async function generateShotList(sessionData: SessionData, answers?: QAContext[]) {
    const answersSection = answers && answers.length > 0
        ? `\n\n    Additional Context from User Q&A:\n${answers.map(qa => `    Q: ${qa.question}\n    A: ${qa.answer}`).join('\n\n')}`
        : '';

    const prompt =
    `You are a professional video planning assistant. Create a detailed shot list for a vlog
        Video Details:
        - Type: ${sessionData.videoType}
        - Duration: ${sessionData.duration}
        - Location Flow: ${sessionData.locationFlow}
        ${sessionData.targetVibe ? `- Target Vibe: ${sessionData.targetVibe}` : ''}
        ${sessionData.equipment ? `- Equipment: ${sessionData.equipment}` : ''}
        ${sessionData.keyMoments ? `- Key Moments: ${sessionData.keyMoments}` : ''}
        ${sessionData.additionalDetails ? `- Additional Details: ${sessionData.additionalDetails}` : ''}${answersSection}
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
        model: "claude-sonnet-4-20250514",
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

export async function generateQuestions(sessionData: SessionData) {
    const prompt =
    `You are a professional video planning assistant. Based on the video details provided, generate 3-5 thoughtful follow-up questions to better understand what the user wants to capture.

        Video Details:
        - Type: ${sessionData.videoType}
        - Duration: ${sessionData.duration}
        - Location Flow: ${sessionData.locationFlow}
        ${sessionData.targetVibe ? `- Target Vibe: ${sessionData.targetVibe}` : ''}
        ${sessionData.equipment ? `- Equipment: ${sessionData.equipment}` : ''}
        ${sessionData.keyMoments ? `- Key Moments: ${sessionData.keyMoments}` : ''}

    Generate questions that help clarify:
    - Key moments or activities to capture at each location
    - The mood or energy level they want
    - Any specific shots or angles they have in mind
    - Time constraints or transitions between locations

    Return ONLY valid JSON (no markdown, no explanation) in this exact format:
    [
        {
            "questionNumber": 1,
            "question": "What's your morning routine like? Any specific rituals you want to highlight?",
            "purpose": "To understand key moments to capture in bedroom"
        }
    ]`;

    const response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 2048,
        messages: [
            {
                role: 'user',
                content: prompt
            }
        ]
    });

    const textContent = (response.content[0] as any).text;
    if (!textContent) {
        throw new Error('No response from Claude API');
    }

    const questions = JSON.parse(textContent);
    if (!Array.isArray(questions)) {
        throw new Error('Invalid response format: expected array of questions');
    }

    return questions;
}

//replanShots()
