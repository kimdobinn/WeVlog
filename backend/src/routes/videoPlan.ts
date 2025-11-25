import {Router} from 'express';
import {supabase, getAuthenticatedClient} from '../config/supabase';
import { generateShotList, generateQuestions } from '../config/claude';
import { requireAuth } from '../middleware/auth';

const router = Router();

//when the frontend calls the endpoint (with necessary data collected), this endpoint saves the data into a table (in a format that we want)
router.post('/sessions', requireAuth, async (req, res) => {
    const{videoType, duration, locationFlow, targetVibe, equipment, keyMoments, additionalDetails} = req.body;
    try{
        const userId = (req as any).user.id;
        const{data, error} = await supabase
        .from('video_plan_sessions')
        .insert({
            user_id: userId,
            video_type: videoType,
            duration: duration,
            location_flow: locationFlow,
            target_vibe: targetVibe,
            equipment: equipment,
            key_moments: keyMoments,
            additional_details: additionalDetails,
            status: 'awaiting_choice'
        })
        .select();
        if(error){
            return res.status(400).json({error: error.message});
        }
        return res.status(201).json({
            sessionId: data[0].id,
            status: data[0].status,
            message: 'Session created successfully'
        });
    }
    catch(error: any){
        return res.status(500).json({error: error.message || 'Failed to create session'});
    }
});

// List all sessions for the logged-in user
router.get('/sessions', requireAuth, async (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '') || '';
    const authClient = getAuthenticatedClient(token);

    try {
        const { data: sessions, error } = await authClient
            .from('video_plan_sessions')
            .select('id, video_type, duration, location_flow, status, created_at')
            .order('created_at', { ascending: false });

        if (error) {
            return res.status(500).json({ error: 'Failed to fetch sessions' });
        }

        const formatted = sessions?.map(s => ({
            id: s.id,
            videoType: s.video_type,
            duration: s.duration,
            locationFlow: s.location_flow,
            status: s.status,
            createdAt: s.created_at
        })) || [];

        return res.status(200).json({
            sessions: formatted,
            total: formatted.length
        });
    } catch (error: any) {
        return res.status(500).json({ error: error.message || 'Failed to fetch sessions' });
    }
});

// Get a single session with all its shots
router.get('/sessions/:sessionId', requireAuth, async (req, res) => {
    const { sessionId } = req.params;
    const token = req.headers.authorization?.replace('Bearer ', '') || '';
    const authClient = getAuthenticatedClient(token);

    try {
        const { data: session, error: sessionError } = await authClient
            .from('video_plan_sessions')
            .select('*')
            .eq('id', sessionId)
            .single();

        if (sessionError || !session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const { data: shots, error: shotsError } = await authClient
            .from('shots')
            .select('*')
            .eq('session_id', sessionId)
            .order('shot_number', { ascending: true });

        return res.status(200).json({
            session: {
                id: session.id,
                videoType: session.video_type,
                duration: session.duration,
                locationFlow: session.location_flow,
                targetVibe: session.target_vibe,
                equipment: session.equipment,
                keyMoments: session.key_moments,
                status: session.status,
                createdAt: session.created_at
            },
            shots: shots || [],
            totalShots: shots?.length || 0
        });
    } catch (error: any) {
        return res.status(500).json({ error: error.message || 'Failed to fetch session' });
    }
});

//takes that table data and sends to to the LLM (claude)
//takes session data from database, sends to Claude LLM, saves generated shots back to database
router.post('/sessions/:sessionId/generate', requireAuth, async (req, res) => {
    const{sessionId} = req.params;
    try{
        const{data: session, error: fetchError} = await supabase
        .from('video_plan_sessions')
        .select('*')
        .eq('id', sessionId)
        .single();
        if(fetchError || !session){
            return res.status(404).json({error: 'Session not found'});
        }
        const sessionData = {
            videoType: session.video_type,
            duration: session.duration,
            locationFlow: session.location_flow,
            targetVibe: session.target_vibe,
            equipment: session.equipment,
            keyMoments: session.key_moments,
            additionalDetails: session.additional_details
        };
        const shots = await generateShotList(sessionData);

        const shotsToInsert = shots.map((shot: any) => ({
            session_id: sessionId,
            shot_number: shot.shotNumber,
            location: shot.location,
            title: shot.title,
            description: shot.description,
            duration: shot.duration,
            shot_type: shot.shotType,
            camera_movement: shot.cameraMovement,
            equipment: shot.equipment,
            tips: shot.tips,
            status: 'pending'
        }));
        const{error: insertError} = await supabase
        .from('shots')
        .insert(shotsToInsert);
        if(insertError){
            return res.status(500).json({error: 'Failed to save shots'});
        }
        await supabase
        .from('video_plan_sessions')
        .update({status: 'active'})
        .eq('id', sessionId);
        return res.status(200).json({
            shotList: shots,
            totalShots: shots.length,
            message: 'Shot list generated successfully'
        });
    } catch(error: any){
        return res.status(500).json({error: error.message || 'Failed to generate shot list'});
    }
});

// "Let's talk!" flow - generates personalized questions for the user
router.post('/sessions/:sessionId/questions', requireAuth, async (req, res) => {
    const { sessionId } = req.params;
    try {
        const { data: session, error: fetchError } = await supabase
            .from('video_plan_sessions')
            .select('*')
            .eq('id', sessionId)
            .single();

        if (fetchError || !session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        const sessionData = {
            videoType: session.video_type,
            duration: session.duration,
            locationFlow: session.location_flow,
            targetVibe: session.target_vibe,
            equipment: session.equipment,
            keyMoments: session.key_moments
        };

        const questions = await generateQuestions(sessionData);

        const questionsToInsert = questions.map((q: any, index: number) => ({
            session_id: sessionId,
            question_text: q.question,
            question_order: index + 1
        }));

        const { error: insertError } = await supabase
            .from('ai_questions')
            .insert(questionsToInsert);

        if (insertError) {
            return res.status(500).json({ error: 'Failed to save questions' });
        }

        await supabase
            .from('video_plan_sessions')
            .update({ status: 'gathering_info' })
            .eq('id', sessionId);

        return res.status(200).json({
            questions: questions,
            totalQuestions: questions.length,
            message: 'Questions generated successfully'
        });
    } catch (error: any) {
        return res.status(500).json({ error: error.message || 'Failed to generate questions' });
    }
});

// Submit answers and generate personalized shot list
router.post('/sessions/:sessionId/answers', requireAuth, async (req, res) => {
    const { sessionId } = req.params;
    const { answers } = req.body; // expects array of { questionId, answerText }
    const token = req.headers.authorization?.replace('Bearer ', '') || '';
    const authClient = getAuthenticatedClient(token);

    try {
        // 1. Fetch session data
        const { data: session, error: sessionError } = await authClient
            .from('video_plan_sessions')
            .select('*')
            .eq('id', sessionId)
            .single();

        if (sessionError || !session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        // 2. Fetch questions for this session
        const { data: questions, error: questionsError } = await authClient
            .from('ai_questions')
            .select('*')
            .eq('session_id', sessionId)
            .order('question_order', { ascending: true });

        if (questionsError || !questions) {
            return res.status(404).json({ error: 'Questions not found for this session' });
        }

        // 3. Save answers to user_answers table
        const answersToInsert = answers.map((a: any) => ({
            session_id: sessionId,
            question_id: a.questionId,
            answer_text: a.answerText
        }));

        const { error: insertError } = await authClient
            .from('user_answers')
            .insert(answersToInsert);

        if (insertError) {
            return res.status(500).json({ error: 'Failed to save answers' });
        }

        // 4. Build Q&A context for Claude
        const qaContext = answers.map((a: any) => {
            const question = questions.find((q: any) => q.id === a.questionId);
            return {
                question: question?.question_text || '',
                answer: a.answerText
            };
        });

        // 5. Build session data
        const sessionData = {
            videoType: session.video_type,
            duration: session.duration,
            locationFlow: session.location_flow,
            targetVibe: session.target_vibe,
            equipment: session.equipment,
            keyMoments: session.key_moments,
            additionalDetails: session.additional_details
        };

        // 6. Generate shots with Q&A context
        const shots = await generateShotList(sessionData, qaContext);

        // 7. Save shots to database
        const shotsToInsert = shots.map((shot: any) => ({
            session_id: sessionId,
            shot_number: shot.shotNumber,
            location: shot.location,
            title: shot.title,
            description: shot.description,
            duration: shot.duration,
            shot_type: shot.shotType,
            camera_movement: shot.cameraMovement,
            equipment: shot.equipment,
            tips: shot.tips,
            status: 'pending'
        }));

        const { error: shotsError } = await authClient
            .from('shots')
            .insert(shotsToInsert);

        if (shotsError) {
            return res.status(500).json({ error: 'Failed to save shots' });
        }

        // 8. Update session status
        await authClient
            .from('video_plan_sessions')
            .update({ status: 'active' })
            .eq('id', sessionId);

        return res.status(200).json({
            shotList: shots,
            totalShots: shots.length,
            message: 'Answers saved and shot list generated successfully'
        });
    } catch (error: any) {
        return res.status(500).json({ error: error.message || 'Failed to process answers' });
    }
});

// Mark a shot as complete or pending (toggle)
router.patch('/shots/:shotId/complete', requireAuth, async (req, res) => {
    const { shotId } = req.params;
    const token = req.headers.authorization?.replace('Bearer ', '') || '';
    const authClient = getAuthenticatedClient(token);

    try {
        // Get current shot status
        const { data: shot, error: fetchError } = await authClient
            .from('shots')
            .select('id, status, session_id')
            .eq('id', shotId)
            .single();

        if (fetchError || !shot) {
            return res.status(404).json({ error: 'Shot not found' });
        }

        // Toggle status
        const newStatus = shot.status === 'completed' ? 'pending' : 'completed';

        const { error: updateError } = await authClient
            .from('shots')
            .update({ status: newStatus })
            .eq('id', shotId);

        if (updateError) {
            return res.status(500).json({ error: 'Failed to update shot status' });
        }

        return res.status(200).json({
            shotId: shot.id,
            status: newStatus,
            message: `Shot marked as ${newStatus}`
        });
    } catch (error: any) {
        return res.status(500).json({ error: error.message || 'Failed to update shot' });
    }
});

export default router;
