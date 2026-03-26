resource "google_cloud_tasks_queue" "callback_queue" {
  name     = var.callback_queue_name
  location = var.task_region

  rate_limits {
    max_concurrent_dispatches = 10
    max_dispatches_per_second = 1
  }

  retry_config {
    max_attempts = 3
  }
}

output "callback_queue_name" {
  value = google_cloud_tasks_queue.callback_queue.name
}