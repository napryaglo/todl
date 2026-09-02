import DocsVM from "./docs-vm.ts"
import DocsSectionVM from "./docs-section-vm.ts"

resources Docs {
    // Short list row — one line, uniform height (stacks reliably in a ListBox).
    DataTemplate x:key="DocsHeadingTemplate" [DataType = DocsSectionVM] {
        TextBlock [ Margin = (4,4,4,4), Text = $Heading ]
    }
    // Detail pane — a single ContentControl target, so wrapping / tall content
    // renders correctly (unlike tall wrapping items inside a list).
    DataTemplate [DataType = DocsSectionVM] {
        ScrollViewer {
            StackPanel [ Orientation = Vertical, Margin = (16,12,16,12) ] {
                TextBlock [ FontSize = 18, FontWeight = Bold, Margin = (0,0,0,8), Text = $Heading ]
                TextBlock [ TextWrapping = Wrap, Foreground = @OnSurfaceVariant, Margin = (0,0,0,12), Text = $Narrative ]
                ContentControl [ Content = $SourceView ]
                TextBlock [ FontSize = 12, FontWeight = Bold, Foreground = @Primary, Margin = (0,10,0,6), Text = $Status ]
                ContentControl [ Content = $JsonView ]
            }
        }
    }
    DataTemplate [DataType = DocsVM] {
        DockPanel {
            TextBlock [ DockPanel.Dock = Top, Margin = (16,12,16,8), FontSize = 18, FontWeight = Bold, Text = $Title ]
            ListBox [ DockPanel.Dock = Left, Width = 280, Margin = (12,0,0,12), ItemsSource = $Sections, ItemTemplate = @DocsHeadingTemplate, SelectedItem = $Selected ]
            ContentControl [ Content = $Selected ]
        }
    }
}
