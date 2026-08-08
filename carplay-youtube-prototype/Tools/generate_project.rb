#!/usr/bin/env ruby
# frozen_string_literal: true

# Regenerates CarPlayYouTube.xcodeproj from the files on disk.
#
# The generated project is committed so the repo can be opened in Xcode directly.
# Re-run this (`make project`) after adding, moving, or deleting source files —
# that keeps the pbxproj free of the merge conflicts hand-editing tends to cause.
#
#   gem install xcodeproj
#   ruby Tools/generate_project.rb

require 'xcodeproj'
require 'fileutils'
require 'pathname'

ROOT = File.expand_path('..', __dir__)
TARGET_NAME = 'CarPlayYouTube'
PROJECT_PATH = File.join(ROOT, "#{TARGET_NAME}.xcodeproj")
BUNDLE_ID = ENV.fetch('BUNDLE_ID', 'com.example.CarPlayYouTube')
DEPLOYMENT_TARGET = '16.0'

def group_for(project, relative_dir)
  return project.main_group if relative_dir == '.'

  relative_dir.split('/').reduce(project.main_group) do |group, name|
    group[name] || group.new_group(name, name)
  end
end

def add(project, target, absolute_path, phase)
  relative = Pathname.new(absolute_path).relative_path_from(Pathname.new(ROOT)).to_s
  group = group_for(project, File.dirname(relative))
  reference = group.new_reference(absolute_path)
  case phase
  when :sources   then target.add_file_references([reference])
  when :resources then target.add_resources([reference])
  end
  reference
end

FileUtils.rm_rf(PROJECT_PATH)
project = Xcodeproj::Project.new(PROJECT_PATH)
target = project.new_target(:application, TARGET_NAME, :ios, DEPLOYMENT_TARGET)

Dir.glob(File.join(ROOT, 'Sources', '**', '*.swift')).sort.each do |file|
  add(project, target, file, :sources)
end

%w[
  Resources/player.html
  Resources/catalog.json
  Resources/Assets.xcassets
].each do |relative|
  add(project, target, File.join(ROOT, relative), :resources)
end

# Info.plist is referenced by build setting, not copied by the resources phase.
add(project, target, File.join(ROOT, 'Resources/Info.plist'), :none)

secrets = File.join(ROOT, 'Config', 'Secrets.xcconfig')
secrets_reference =
  if File.exist?(secrets)
    add(project, target, secrets, :none)
  else
    add(project, target, File.join(ROOT, 'Config', 'Secrets.example.xcconfig'), :none)
    nil
  end

target.build_configurations.each do |config|
  config.base_configuration_reference = secrets_reference if secrets_reference
  config.build_settings.merge!(
    'PRODUCT_BUNDLE_IDENTIFIER' => BUNDLE_ID,
    'PRODUCT_NAME' => '$(TARGET_NAME)',
    'INFOPLIST_FILE' => 'Resources/Info.plist',
    'GENERATE_INFOPLIST_FILE' => 'NO',
    'SWIFT_VERSION' => '5.0',
    'IPHONEOS_DEPLOYMENT_TARGET' => DEPLOYMENT_TARGET,
    'TARGETED_DEVICE_FAMILY' => '1,2',
    'ASSETCATALOG_COMPILER_APPICON_NAME' => 'AppIcon',
    'ASSETCATALOG_COMPILER_GLOBAL_ACCENT_COLOR_NAME' => 'AccentColor',
    'CODE_SIGN_STYLE' => 'Automatic',
    'MARKETING_VERSION' => '0.1.0',
    'CURRENT_PROJECT_VERSION' => '1',
    'ENABLE_USER_SCRIPT_SANDBOXING' => 'YES',
    'CLANG_ENABLE_MODULES' => 'YES',
    'SWIFT_EMIT_LOC_STRINGS' => 'NO'
  )
end

project.save

scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.set_launch_target(target)
scheme.save_as(PROJECT_PATH, TARGET_NAME, true)

swift_files = target.source_build_phase.files.count
puts "Generated #{File.basename(PROJECT_PATH)} (#{swift_files} Swift files, bundle id #{BUNDLE_ID})"
