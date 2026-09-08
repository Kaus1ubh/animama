{
  "targets": [
    {
      "target_name": "animama_input_hook",
      "sources": ["src/addon.cc"],
      "defines": ["NAPI_VERSION=8"],
      "conditions": [
        [
          "OS=='mac'",
          {
            "sources": ["src/hook_mac.cc"],
            "xcode_settings": {
              "CLANG_CXX_LANGUAGE_STANDARD": "c++20",
              "MACOSX_DEPLOYMENT_TARGET": "15.0",
              "OTHER_LDFLAGS": ["-Wl,-S"]
            },
            "link_settings": {
              "libraries": [
                "-framework ApplicationServices",
                "-framework CoreFoundation"
              ]
            }
          }
        ],
        [
          "OS=='win'",
          {
            "sources": ["src/hook_windows.cc"],
            "defines": ["UNICODE", "_UNICODE", "WIN32_LEAN_AND_MEAN"],
            "msvs_settings": {
              "VCCLCompilerTool": {
                "AdditionalOptions": ["/std:c++20"]
              }
            },
            "libraries": ["user32.lib"]
          }
        ],
        [
          "OS!='mac' and OS!='win'",
          { "sources": ["src/hook_unsupported.cc"] }
        ]
      ]
    }
  ]
}
