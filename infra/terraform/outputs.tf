output "project_id" {
  value = var.project_id
}

output "region" {
  value = var.region
}

output "storage_bucket" {
  value = google_storage_bucket.reports.name
}

output "cloud_run_url" {
  value = google_cloud_run_v2_service.backend.uri
}

output "service_account" {
  value = google_service_account.backend_sa.email
}
