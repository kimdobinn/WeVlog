import {Router} from 'express';
import {supabase} from '../config/supabase';
import { generateShotList } from '../config/claude';

const router = Router();

//when the frontend calls the endpoint (with necessary data collected), this endpoint saves the data into a table (in a format that we want)
router.post('/sessions', async (req, res) => {
    const{videoType, duration, locationFlow, targetVibe, equipment, keyMoments, additionalDetails} = req.body;
    try{
        const userId = 'dc6a8bb2-1a7b-4563-a2ac-b8d6092eaa93';
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

//takes that table data and sends to to the LLM (claude)
//takes session data from database, sends to Claude LLM, saves generated shots back to database
router.post('/sessions/:sessionId/generate', async (req, res) => {
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
export default router;

