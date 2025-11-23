import {Router} from 'express';
import {supabase} from '../config/supabase';

const router = Router();

router.post('/signup', async (req, res) => {
   const{email, password} = req.body;
   const{data, error} = await supabase.auth.signUp({
    email,
    password
   });
   if(error){
    return res.status(400).json({error:error.message});
   }
   return res.status(201).json({
    message: 'User created successfully',
    user: data.user
   });
});

router.post('/login', async (req, res) => {
    const{email, password} = req.body;
    const{data, error} = await supabase.auth.signInWithPassword({
        email,
        password
    });
    if(error){
        return res.status(401).json({error: error.message});
    }
    return res.status(200).json({
        message: 'Login successful',
        user: data.user,
        session: data.session
    });
});

export default router;