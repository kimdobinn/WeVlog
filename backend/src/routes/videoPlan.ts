import {Router} from 'express';
import {supabase, getAuthenticatedClient} from '../config/supabase';
import { generateShotList, generateQuestions, replanShots } from '../config/claude';
import { getUploadUrl, getDownloadUrl, deleteFile, generateVideoKey } from '../config/s3';
import { requireAuth } from '../middleware/auth';

const router = Router();

//when the frontend calls the endpoint (with necessary data collected), this endpoint saves the data into a table (in a format that we want)
router.post('/sessions', requireAuth, async (req, res) => {
    const{videoType, duration, locationFlow, targetVibe, equipment, keyMoments, additionalDetails} = req.body;
    const token = req.headers.authorization?.replace('Bearer ', '') || '';
    const authClient = getAuthenticatedClient(token);
    try{
        const userId = (req as any).user.id;
        const{data, error} = await authClient
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
    const token = req.headers.authorization?.replace('Bearer ', '') || '';
    const authClient = getAuthenticatedClient(token);
    try{
        const{data: session, error: fetchError} = await authClient
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
        const{error: insertError} = await authClient
        .from('shots')
        .insert(shotsToInsert);
        if(insertError){
            return res.status(500).json({error: 'Failed to save shots'});
        }
        await authClient
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
    const token = req.headers.authorization?.replace('Bearer ', '') || '';
    const authClient = getAuthenticatedClient(token);
    try {
        const { data: session, error: fetchError } = await authClient
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

        const { error: insertError } = await authClient
            .from('ai_questions')
            .insert(questionsToInsert);

        if (insertError) {
            return res.status(500).json({ error: 'Failed to save questions' });
        }

        await authClient
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

// Replan shots based on user feedback
router.post('/sessions/:sessionId/replan', requireAuth, async (req, res) => {
    const { sessionId } = req.params;
    const { feedback } = req.body;
    const token = req.headers.authorization?.replace('Bearer ', '') || '';
    const authClient = getAuthenticatedClient(token);

    if (!feedback) {
        return res.status(400).json({ error: 'Feedback is required' });
    }

    try {
        // 1. Get session
        const { data: session, error: sessionError } = await authClient
            .from('video_plan_sessions')
            .select('*')
            .eq('id', sessionId)
            .single();

        if (sessionError || !session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        // 2. Get current shots
        const { data: currentShots, error: shotsError } = await authClient
            .from('shots')
            .select('*')
            .eq('session_id', sessionId)
            .order('shot_number', { ascending: true });

        if (shotsError || !currentShots || currentShots.length === 0) {
            return res.status(404).json({ error: 'No shots found for this session' });
        }

        // 3. Build session data and shots for Claude
        const sessionData = {
            videoType: session.video_type,
            duration: session.duration,
            locationFlow: session.location_flow,
            targetVibe: session.target_vibe,
            equipment: session.equipment
        };

        const shotsForReplan = currentShots.map((s: any) => ({
            shotNumber: s.shot_number,
            location: s.location,
            title: s.title,
            description: s.description,
            duration: s.duration,
            shotType: s.shot_type,
            cameraMovement: s.camera_movement,
            equipment: s.equipment,
            tips: s.tips,
            status: s.status
        }));

        // 4. Call Claude for replanning
        const newShots = await replanShots(sessionData, shotsForReplan, feedback);

        // 5. Delete old shots
        await authClient
            .from('shots')
            .delete()
            .eq('session_id', sessionId);

        // 6. Insert new shots
        const shotsToInsert = newShots.map((shot: any) => ({
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

        const { error: insertError } = await authClient
            .from('shots')
            .insert(shotsToInsert);

        if (insertError) {
            return res.status(500).json({ error: 'Failed to save new shots' });
        }

        return res.status(200).json({
            shotList: newShots,
            totalShots: newShots.length,
            message: 'Shot list replanned successfully'
        });
    } catch (error: any) {
        return res.status(500).json({ error: error.message || 'Failed to replan shots' });
    }
});

// Delete a session and all related data
router.delete('/sessions/:sessionId', requireAuth, async (req, res) => {
    const { sessionId } = req.params;
    const token = req.headers.authorization?.replace('Bearer ', '') || '';
    const authClient = getAuthenticatedClient(token);

    try {
        // Verify session exists and belongs to user
        const { data: session, error: sessionError } = await authClient
            .from('video_plan_sessions')
            .select('id')
            .eq('id', sessionId)
            .single();

        if (sessionError || !session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        // Delete in order: answers -> questions -> shots -> session
        await authClient.from('user_answers').delete().eq('session_id', sessionId);
        await authClient.from('ai_questions').delete().eq('session_id', sessionId);
        await authClient.from('shots').delete().eq('session_id', sessionId);

        const { error: deleteError } = await authClient
            .from('video_plan_sessions')
            .delete()
            .eq('id', sessionId);

        if (deleteError) {
            return res.status(500).json({ error: 'Failed to delete session' });
        }

        return res.status(200).json({ message: 'Session deleted successfully' });
    } catch (error: any) {
        return res.status(500).json({ error: error.message || 'Failed to delete session' });
    }
});

// Get presigned URL for uploading video to a shot
router.post('/shots/:shotId/upload-url', requireAuth, async (req, res) => {
    const { shotId } = req.params;
    const { filename, contentType } = req.body;
    const token = req.headers.authorization?.replace('Bearer ', '') || '';
    const authClient = getAuthenticatedClient(token);

    if (!filename || !contentType) {
        return res.status(400).json({ error: 'filename and contentType are required' });
    }

    try {
        // Get shot to verify ownership and get session_id
        const { data: shot, error: shotError } = await authClient
            .from('shots')
            .select('id, session_id, video_s3_key')
            .eq('id', shotId)
            .single();

        if (shotError || !shot) {
            return res.status(404).json({ error: 'Shot not found' });
        }

        // Generate S3 key
        const s3Key = generateVideoKey(shot.session_id, shotId, filename);

        // Get presigned upload URL
        const uploadUrl = await getUploadUrl(s3Key, contentType);

        return res.status(200).json({
            uploadUrl,
            s3Key,
            expiresIn: 900
        });
    } catch (error: any) {
        return res.status(500).json({ error: error.message || 'Failed to generate upload URL' });
    }
});

// Confirm video upload and save S3 key to database
router.post('/shots/:shotId/confirm-upload', requireAuth, async (req, res) => {
    const { shotId } = req.params;
    const { s3Key } = req.body;
    const token = req.headers.authorization?.replace('Bearer ', '') || '';
    const authClient = getAuthenticatedClient(token);

    if (!s3Key) {
        return res.status(400).json({ error: 's3Key is required' });
    }

    try {
        // Delete old video if exists
        const { data: shot, error: fetchError } = await authClient
            .from('shots')
            .select('video_s3_key')
            .eq('id', shotId)
            .single();

        if (fetchError || !shot) {
            return res.status(404).json({ error: 'Shot not found' });
        }

        if (shot.video_s3_key) {
            await deleteFile(shot.video_s3_key);
        }

        // Update shot with new S3 key
        const { error: updateError } = await authClient
            .from('shots')
            .update({ video_s3_key: s3Key })
            .eq('id', shotId);

        if (updateError) {
            return res.status(500).json({ error: 'Failed to save video reference' });
        }

        return res.status(200).json({
            message: 'Video upload confirmed',
            shotId,
            s3Key
        });
    } catch (error: any) {
        return res.status(500).json({ error: error.message || 'Failed to confirm upload' });
    }
});

// Get presigned URL for viewing/downloading video
router.get('/shots/:shotId/video-url', requireAuth, async (req, res) => {
    const { shotId } = req.params;
    const token = req.headers.authorization?.replace('Bearer ', '') || '';
    const authClient = getAuthenticatedClient(token);

    try {
        const { data: shot, error: shotError } = await authClient
            .from('shots')
            .select('video_s3_key')
            .eq('id', shotId)
            .single();

        if (shotError || !shot) {
            return res.status(404).json({ error: 'Shot not found' });
        }

        if (!shot.video_s3_key) {
            return res.status(404).json({ error: 'No video uploaded for this shot' });
        }

        const videoUrl = await getDownloadUrl(shot.video_s3_key);

        return res.status(200).json({
            videoUrl,
            expiresIn: 3600
        });
    } catch (error: any) {
        return res.status(500).json({ error: error.message || 'Failed to get video URL' });
    }
});

// Delete video from a shot
router.delete('/shots/:shotId/video', requireAuth, async (req, res) => {
    const { shotId } = req.params;
    const token = req.headers.authorization?.replace('Bearer ', '') || '';
    const authClient = getAuthenticatedClient(token);

    try {
        const { data: shot, error: shotError } = await authClient
            .from('shots')
            .select('video_s3_key')
            .eq('id', shotId)
            .single();

        if (shotError || !shot) {
            return res.status(404).json({ error: 'Shot not found' });
        }

        if (!shot.video_s3_key) {
            return res.status(404).json({ error: 'No video to delete' });
        }

        // Delete from S3
        await deleteFile(shot.video_s3_key);

        // Clear S3 key in database
        const { error: updateError } = await authClient
            .from('shots')
            .update({ video_s3_key: null })
            .eq('id', shotId);

        if (updateError) {
            return res.status(500).json({ error: 'Failed to update database' });
        }

        return res.status(200).json({ message: 'Video deleted successfully' });
    } catch (error: any) {
        return res.status(500).json({ error: error.message || 'Failed to delete video' });
    }
});

export default router;
