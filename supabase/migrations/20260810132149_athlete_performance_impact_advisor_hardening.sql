-- Exact covering indexes for the two composite Impact foreign keys identified
-- by the Supabase performance advisor.

create index if not exists fuel_performance_results_metric_user_fk_idx
  on public.fuel_performance_results (metric_id, user_id);

create index if not exists fuel_training_feedback_session_user_fk_idx
  on public.fuel_training_feedback (training_mode_session_id, user_id);
