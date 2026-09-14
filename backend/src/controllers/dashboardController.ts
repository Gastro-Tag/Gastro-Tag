import { Request, Response } from 'express';
import { DashboardService } from '../services/dashboardService';

export const DashboardController = {
  async getStats(_req: Request, res: Response) {
    const stats = await DashboardService.getStats();
    res.json({ success: true, data: stats });
  },
};
