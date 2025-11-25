import {Request, Response, NextFunction} from 'express';
import {supabase} from '../config/supabase';

export async function requireAuth(req: Request, res: Response, next: NextFunction){
    const authHeader = req.headers.authorization;
    if(!authHeader){
        return res.status(401).json({error: 'No authorization token provided'});
    }
    const token = authHeader?.replace('Bearer ', '');
    try{
        const{data:{user}, error} = await supabase.auth.getUser(token);
        if(error || !user) {
            return res.status(401).json({error: 'Invalid or expired token'});
        }

        (req as any).user = user;
        next();
    } catch (error: any) {
        return res.status(401).json({ error: 'Authentication failed' });
    }
}