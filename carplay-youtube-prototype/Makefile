TARGET  := CarPlayYouTube
PROJECT := $(TARGET).xcodeproj
DEST    ?= platform=iOS Simulator,name=iPhone 16 Pro

.PHONY: help project build clean open secrets

help:
	@echo "make project  - regenerate $(PROJECT) from files on disk"
	@echo "make build    - build for the simulator ($(DEST))"
	@echo "make open     - open the project in Xcode"
	@echo "make secrets  - create Config/Secrets.xcconfig from the example"
	@echo "make clean    - remove build output"

project:
	ruby Tools/generate_project.rb

build:
	xcodebuild -project $(PROJECT) -scheme $(TARGET) -destination '$(DEST)' build

open:
	open $(PROJECT)

secrets:
	@test -f Config/Secrets.xcconfig \
		&& echo "Config/Secrets.xcconfig already exists" \
		|| (cp Config/Secrets.example.xcconfig Config/Secrets.xcconfig \
			&& echo "Created Config/Secrets.xcconfig — add your key, then run 'make project'")

clean:
	rm -rf build DerivedData
	xcodebuild -project $(PROJECT) -scheme $(TARGET) clean || true
