resource "google_storage_bucket" "reports" {
  name          = "med-voice-reports-${var.project_id}"
  location      = var.region
  force_destroy = true

  uniform_bucket_level_access = true

  cors {
    origin          = ["http://localhost:3000", "https://med-voice--sm-gemini-playground.europe-west4.hosted.app"]
    method          = ["GET", "PUT", "POST", "DELETE", "HEAD", "OPTIONS"]
    response_header = ["*"]
    max_age_seconds = 3600
  }

  versioning {
    enabled = true
  }
}

output "reports_bucket_name" {
  value = google_storage_bucket.reports.name
}
