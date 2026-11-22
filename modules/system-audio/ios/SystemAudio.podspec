Pod::Spec.new do |s|
  s.name           = 'SystemAudio'
  s.version        = '1.0.0'
  s.summary        = 'System volume slider and AirPlay route picker for Music Seerr'
  s.description    = s.summary
  s.author         = 'Music Seerr'
  s.homepage       = 'https://github.com/giulio177/music-seerr-ios'
  s.license        = 'MIT'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: 'https://github.com/giulio177/music-seerr-ios.git' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES' }
  s.source_files = '**/*.swift'
end
