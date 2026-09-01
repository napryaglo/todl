import ExampleRunnerVM from "./example-runner-vm.ts"
import DiagnosticVM from "./diagnostic-vm.ts"

resources ExampleRunner {
    DataTemplate [DataType = DiagnosticVM] {
        TextBlock [ Margin = (0,0,0,2), FontFamily = "Cascadia Mono, Consolas, monospace", FontSize = 12, Text = $Line ]
    }
    DataTemplate [DataType = ExampleRunnerVM] {
        UniformGrid [ Columns = 2 ] {
            TextBox
                [ Margin        = (8,8,8,8),
                  AcceptsReturn = true,
                  AcceptsTab    = true,
                  TextWrapping  = NoWrap,
                  IsReadOnly    = $ReadOnly,
                  FontFamily    = "Cascadia Mono, Consolas, monospace",
                  FontSize      = 13,
                  Text          = $Source ]
            DockPanel [ Margin = (8,8,8,8) ] {
                TextBlock [ DockPanel.Dock = Top, FontWeight = Bold, Margin = (0,0,0,6), Text = $Status ]
                ListBox   [ DockPanel.Dock = Top, Items = $Diagnostics, Height = 140 ]
                ScrollViewer {
                    TextBlock [ FontFamily = "Cascadia Mono, Consolas, monospace", FontSize = 12, TextWrapping = NoWrap, Text = $Json ]
                }
            }
        }
    }
}
